
// ═══════════════════════════════════════════════════════════
// dbService — Unified Database Abstraction (Firebase / LocalStorage)
// ═══════════════════════════════════════════════════════════

const dbService = {
  isFirebaseActive: false,
  db: null,       // Firestore instance
  auth: null,     // Firebase Auth instance
  storage: null,  // Firebase Storage instance
  currentUser: null,

  init() {
    // Check if Firebase config has real keys (not placeholders)
    const hasRealConfig = typeof firebaseConfig !== "undefined"
      && firebaseConfig.apiKey
      && firebaseConfig.apiKey !== "YOUR_API_KEY"
      && firebaseConfig.projectId
      && firebaseConfig.projectId !== "YOUR_PROJECT_ID";

    if (hasRealConfig && typeof firebase !== "undefined") {
      try {
        firebase.initializeApp(firebaseConfig);
        this.auth = firebase.auth();
        this.db = firebase.firestore();
        this.storage = firebase.storage();
        this.isFirebaseActive = true;
        console.log("[dbService] Cloud Mode activated — Firebase connected.");
      } catch (err) {
        console.warn("[dbService] Firebase init failed, falling back to Local Mode.", err);
        this.isFirebaseActive = false;
      }
    } else {
      this.isFirebaseActive = false;
      console.log("[dbService] Local Mode — using LocalStorage.");
    }
  },

  // ── LocalStorage Helpers ─────────────────────────────────
  _lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },

  _lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },

  // ── Collections CRUD ─────────────────────────────────────
  async getCollections(userId) {
    if (!this.isFirebaseActive) {
      return this._lsGet("app_collections", null);
    }
    const snap = await this.db.collection("users").doc(userId).collection("collections").get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  async saveCollections(collectionsArr, userId) {
    if (!this.isFirebaseActive) {
      this._lsSet("app_collections", collectionsArr);
      return;
    }
    const batch = this.db.batch();
    const colRef = this.db.collection("users").doc(userId).collection("collections");
    collectionsArr.forEach(col => {
      batch.set(colRef.doc(col.id), { ...col });
    });
    await batch.commit();
  },

  async saveCollection(collection, userId) {
    if (!this.isFirebaseActive) {
      const cols = this._lsGet("app_collections", []);
      const idx = cols.findIndex(c => c.id === collection.id);
      if (idx >= 0) cols[idx] = collection;
      else cols.push(collection);
      this._lsSet("app_collections", cols);
      return;
    }
    await this.db.collection("users").doc(userId).collection("collections").doc(collection.id).set(collection);
  },

  async deleteCollection(collectionId, userId) {
    if (!this.isFirebaseActive) {
      let cols = this._lsGet("app_collections", []);
      cols = cols.filter(c => c.id !== collectionId);
      this._lsSet("app_collections", cols);
      // Also delete items from this collection
      let its = this._lsGet("app_items", []);
      its = its.filter(it => it.collectionId !== collectionId);
      this._lsSet("app_items", its);
      return;
    }
    // Delete collection doc
    await this.db.collection("users").doc(userId).collection("collections").doc(collectionId).delete();
    // Delete items belonging to this collection
    const itemsSnap = await this.db.collection("users").doc(userId).collection("items").where("collectionId", "==", collectionId).get();
    const batch = this.db.batch();
    itemsSnap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  },

  // ── Items CRUD ───────────────────────────────────────────
  async getItems(userId) {
    if (!this.isFirebaseActive) {
      return this._lsGet("app_items", null);
    }
    const snap = await this.db.collection("users").doc(userId).collection("items").get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  },

  async saveItems(itemsArr, userId) {
    if (!this.isFirebaseActive) {
      this._lsSet("app_items", itemsArr);
      return;
    }
    const batch = this.db.batch();
    const itemRef = this.db.collection("users").doc(userId).collection("items");
    itemsArr.forEach(item => {
      batch.set(itemRef.doc(item.id), { ...item });
    });
    await batch.commit();
  },

  async saveItem(item, userId) {
    if (!this.isFirebaseActive) {
      const its = this._lsGet("app_items", []);
      const idx = its.findIndex(i => i.id === item.id);
      if (idx >= 0) its[idx] = item;
      else its.unshift(item);
      this._lsSet("app_items", its);
      return;
    }
    await this.db.collection("users").doc(userId).collection("items").doc(item.id).set(item);
  },

  async deleteItem(itemId, userId) {
    if (!this.isFirebaseActive) {
      let its = this._lsGet("app_items", []);
      its = its.filter(i => i.id !== itemId);
      this._lsSet("app_items", its);
      return;
    }
    await this.db.collection("users").doc(userId).collection("items").doc(itemId).delete();
  },

  async deleteItems(itemIds, userId) {
    if (!this.isFirebaseActive) {
      let its = this._lsGet("app_items", []);
      its = its.filter(i => !itemIds.includes(i.id));
      this._lsSet("app_items", its);
      return;
    }
    const batch = this.db.batch();
    const itemRef = this.db.collection("users").doc(userId).collection("items");
    itemIds.forEach(id => batch.delete(itemRef.doc(id)));
    await batch.commit();
  },

  // ── Photo Upload ─────────────────────────────────────────
  async uploadPhoto(dataUrl, userId) {
    // In Local Mode, just return the data URL as-is (Base64)
    if (!this.isFirebaseActive) {
      return dataUrl;
    }
    // In Cloud Mode, upload to Firebase Storage and return the download URL
    const filename = `photos/${userId}/${Date.now()}.png`;
    const ref = this.storage.ref(filename);
    await ref.putString(dataUrl, "data_url");
    return ref.getDownloadURL();
  },

  // ── Persist All ──────────────────────────────────────────
  async persistAll() {
    const uid = this.currentUser ? this.currentUser.uid : null;
    await this.saveCollections(collections, uid);
    await this.saveItems(items, uid);
  },

  // ── Auth Helpers ─────────────────────────────────────────
  async signIn(email, password) {
    return this.auth.signInWithEmailAndPassword(email, password);
  },

  async signUp(email, password) {
    return this.auth.createUserWithEmailAndPassword(email, password);
  },

  async signOut() {
    return this.auth.signOut();
  },

  getAuthErrorMessage(errorCode) {
    const lang = state.lang || "en";
    const map = {
      "auth/invalid-email": i18n[lang].authErrorInvalidEmail,
      "auth/wrong-password": i18n[lang].authErrorWrongPassword,
      "auth/user-not-found": i18n[lang].authErrorUserNotFound,
      "auth/email-already-in-use": i18n[lang].authErrorEmailInUse,
      "auth/weak-password": i18n[lang].authErrorWeakPassword,
      "auth/invalid-credential": i18n[lang].authErrorWrongPassword,
    };
    return map[errorCode] || i18n[lang].authError;
  },
};

// Initialize the dbService immediately
dbService.init();


let selectedCollectionAccent = "";
let selectedCollectionVisibility = "Private";

const collectionPalette = [
  { name: "Lime Green", color: "#93f327", accent: "radial-gradient(circle at 50% 55%, #93f327 0%, rgba(147,243,39,0.5) 25%, rgba(147,243,39,0.15) 60%, rgba(147,243,39,0) 90%), #f2fde9" },
  { name: "Teal", color: "#00cbb6", accent: "radial-gradient(circle at 50% 55%, #00cbb6 0%, rgba(0, 203, 182, 0.5) 25%, rgba(0, 203, 182, 0.15) 60%, rgba(0, 203, 182, 0) 90%), #e5fbf9" },
  { name: "Pink", color: "#ff5eb8", accent: "radial-gradient(circle at 50% 55%, #ff5eb8 0%, rgba(255, 94, 184, 0.5) 25%, rgba(255, 94, 184, 0.15) 60%, rgba(255, 94, 184, 0) 90%), #fff1f8" },
  { name: "Purple", color: "#9d65ff", accent: "radial-gradient(circle at 50% 55%, #9d65ff 0%, rgba(157, 101, 255, 0.5) 25%, rgba(157, 101, 255, 0.15) 60%, rgba(157, 101, 255, 0) 90%), #f6f3ff" },
  { name: "Yellow", color: "#fcfb09", accent: "radial-gradient(circle at 50% 55%, #fcfb09 0%, rgba(252, 251, 9, 0.5) 25%, rgba(252, 251, 9, 0.15) 60%, rgba(252, 251, 9, 0) 90%), #fcfedf" },
  { name: "Orange", color: "#ff7a3d", accent: "radial-gradient(circle at 50% 55%, #ff7a3d 0%, rgba(255, 122, 61, 0.5) 25%, rgba(255, 122, 61, 0.15) 60%, rgba(255, 122, 61, 0) 90%), #fff3ee" },
  { name: "Blue", color: "#0a58ff", accent: "radial-gradient(circle at 50% 55%, #0a58ff 0%, rgba(10, 88, 255, 0.5) 25%, rgba(10, 88, 255, 0.15) 60%, rgba(10, 88, 255, 0) 90%), #edf3ff" }
];

// Reusable swatch picker — used by both the Add and Edit collection sheets.
function buildColorPicker(containerId, selectedAccent, onSelect) {
  const picker = document.getElementById(containerId);
  if (!picker) return;
  picker.innerHTML = collectionPalette.map(item => {
    const sel = item.accent === selectedAccent ? "is-selected" : "";
    return `<button class="color-option ${sel}" type="button" data-accent="${item.accent}" style="background: ${item.color};" aria-label="${item.name}"></button>`;
  }).join("");
  picker.querySelectorAll(".color-option").forEach(btn => {
    btn.addEventListener("click", () => {
      picker.querySelectorAll(".color-option").forEach(b => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      onSelect(btn.dataset.accent);
    });
  });
}

function renderCollectionColorPicker() {
  buildColorPicker("collectionColorPicker", collectionPalette[0].accent, (accent) => {
    selectedCollectionAccent = accent;
  });
}

function openAddCollectionSheet() {
  sheetBackdrop.hidden = false;
  addCollectionSheet.setAttribute("aria-hidden", "false");
  addCollectionSheet.classList.add("is-open");
  if (window.floatingAddBtn) {
    floatingAddBtn.classList.add("is-hidden");
  }
  
  addCollectionForm.reset();
  
  renderCollectionColorPicker();
  selectedCollectionAccent = collectionPalette[0].accent;
  
  selectedCollectionVisibility = "Private";
  document.querySelectorAll("#collectionVisibilitySegmented button").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.visibility === "Private");
  });
}

function getScreenLabels(screen) {
  if (screen === "collections") {
    return [i18n[state.lang].screenCollectionsTitle, ""];
  }
  if (screen === "settings") {
    return [i18n[state.lang].screenSettingsTitle, i18n[state.lang].screenSettingsKicker];
  }
  return ["", ""];
}

function translateVisibility(vis) {
  if (vis === "Private") return i18n[state.lang].visibilityPrivate;
  if (vis === "Public") return i18n[state.lang].visibilityPublic;
  if (vis === "Friends") return i18n[state.lang].visibilityFriends;
  return vis;
}

function updateLanguage() {
  // 2. Add Screen Labels
  const addScreen = document.getElementById("addSheet");
  if (addScreen) {
    const photoCameraBtn = addScreen.querySelector('[data-photo-source="camera"]');
    if (photoCameraBtn) {
      photoCameraBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg> ${state.lang === 'zh' ? '拍照' : 'Camera'}`;
    }
    const photoAlbumBtn = addScreen.querySelector('[data-photo-source="album"]');
    if (photoAlbumBtn) {
      photoAlbumBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg> ${state.lang === 'zh' ? '相册' : 'Photo album'}`;
    }
    
    const labels = addScreen.querySelectorAll("label span");
    labels.forEach(label => {
      const text = label.textContent.trim();
      if (text.startsWith("Title") || text.startsWith("名称")) {
        label.textContent = state.lang === 'zh' ? '名称' : 'Title';
      } else if (text.startsWith("Collection") || text.startsWith("隶属收藏夹")) {
        label.textContent = state.lang === 'zh' ? '隶属收藏夹' : 'Collection';
      } else if (text.startsWith("Rating") || text.startsWith("评分")) {
        label.textContent = state.lang === 'zh' ? '评分 1-10' : 'Rating 1-10';
      } else if (text.startsWith("Status") || text.startsWith("状态")) {
        label.textContent = state.lang === 'zh' ? '状态' : 'Status';
      } else if (text.startsWith("Date added") || text.startsWith("添加日期")) {
        label.textContent = state.lang === 'zh' ? '添加日期' : 'Date added';
      } else if (text.startsWith("Price") || text.startsWith("价格")) {
        label.textContent = state.lang === 'zh' ? '价格 (可选)' : 'Price optional';
      } else if (text.startsWith("Rarity") || text.startsWith("稀有度")) {
        label.textContent = state.lang === 'zh' ? '稀有度 (可选)' : 'Rarity optional';
      } else if (text.startsWith("Notes") || text.startsWith("备注")) {
        label.textContent = state.lang === 'zh' ? '备注 (可选)' : 'Notes optional';
      }
    });
    
    const statusSelect = document.getElementById("itemStatus");
    if (statusSelect && statusSelect.options.length >= 2) {
      statusSelect.options[0].text = state.lang === 'zh' ? '已拥有' : 'Owned';
      statusSelect.options[1].text = state.lang === 'zh' ? '心愿单' : 'Wishlist';
    }
    
    const submitBtn = addScreen.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.textContent = state.lang === 'zh' ? '添加到收藏' : 'Add to collection';
    }
  }
  
  // 3. Edit Collection Bottom Sheet
  const editSheet = document.getElementById("editCollectionSheet");
  if (editSheet) {
    const microLabel = editSheet.querySelector(".micro-label");
    if (microLabel) microLabel.textContent = i18n[state.lang].manageSpace;
    
    const h3 = editSheet.querySelector("h3");
    if (h3) h3.textContent = i18n[state.lang].editCollection;
    
    const renameLabel = editSheet.querySelector('label[for="renameCollectionInput"]');
    if (renameLabel) renameLabel.textContent = i18n[state.lang].renameCollection;
    
    const saveBtn = document.getElementById("saveCollectionNameBtn");
    if (saveBtn) saveBtn.textContent = i18n[state.lang].renameBtn;
    
    const colorLabel = document.getElementById("editCollectionColorLabel");
    if (colorLabel) colorLabel.textContent = i18n[state.lang].editCollectionColorLabel;

    const editVisLabel = document.getElementById("editCollectionVisibilityLabel");
    if (editVisLabel) editVisLabel.textContent = i18n[state.lang].addCollectionVisibilityLabel;

    const editVisBtns = document.querySelectorAll("#editCollectionVisibilitySegmented button");
    if (editVisBtns.length >= 3) {
      editVisBtns[0].textContent = i18n[state.lang].visibilityPrivate;
      editVisBtns[1].textContent = i18n[state.lang].visibilityFriends;
      editVisBtns[2].textContent = i18n[state.lang].visibilityPublic;
    }

    const batchLabel = document.getElementById("batchActionsLabel");
    if (batchLabel) batchLabel.textContent = i18n[state.lang].batchActions;

    const batchBtn = document.getElementById("batchDeleteModeBtn");
    if (batchBtn) batchBtn.innerHTML = `🗑️ ${i18n[state.lang].batchDeletePrompt}`;

    const shareLabel = document.getElementById("shareCollectionLabel");
    if (shareLabel) shareLabel.textContent = i18n[state.lang].shareCollectionLabel;

    const shareBtn = document.getElementById("shareCollectionBtn");
    if (shareBtn) shareBtn.innerHTML = i18n[state.lang].shareCollectionBtn;

    const reorderLabel = document.getElementById("manualReorderingLabel");
    if (reorderLabel) reorderLabel.textContent = i18n[state.lang].manualReordering;
    
    const reorderSub = editSheet.querySelector('.edit-section p');
    if (reorderSub) reorderSub.textContent = i18n[state.lang].manualReorderingSub;

    const dangerZoneLabel = document.getElementById("dangerZoneLabel");
    if (dangerZoneLabel) dangerZoneLabel.textContent = i18n[state.lang].dangerZone || "Danger Zone";

    const deleteCollectionBtn = document.getElementById("deleteCollectionBtn");
    if (deleteCollectionBtn) deleteCollectionBtn.innerHTML = `🗑️ ${i18n[state.lang].deleteCollectionBtn || "Delete Collection"}`;
  }

  // Add Collection Bottom Sheet
  const addColSheet = document.getElementById("addCollectionSheet");
  if (addColSheet) {
    const spaceLabel = document.getElementById("addCollectionSpaceLabel");
    if (spaceLabel) spaceLabel.textContent = i18n[state.lang].addCollectionSpaceLabel;
    
    const heading = document.getElementById("addCollectionHeading");
    if (heading) heading.textContent = i18n[state.lang].addCollectionHeading;
    
    const labels = addColSheet.querySelectorAll("label span");
    if (labels.length >= 4) {
      labels[0].textContent = i18n[state.lang].addCollectionTitleLabel;
      labels[1].textContent = i18n[state.lang].addCollectionDescLabel;
      labels[2].textContent = i18n[state.lang].addCollectionColorLabel;
      labels[3].textContent = i18n[state.lang].addCollectionVisibilityLabel;
    }
    
    const titleInput = document.getElementById("addCollectionTitle");
    if (titleInput) titleInput.placeholder = i18n[state.lang].addCollectionTitlePlaceholder;
    
    const descInput = document.getElementById("addCollectionDesc");
    if (descInput) descInput.placeholder = i18n[state.lang].addCollectionDescPlaceholder;
    
    const submitBtn = addColSheet.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = i18n[state.lang].addCollectionSubmitBtn;
    
    const visBtns = document.querySelectorAll("#collectionVisibilitySegmented button");
    if (visBtns.length >= 3) {
      visBtns[0].textContent = i18n[state.lang].visibilityPrivate;
      visBtns[1].textContent = i18n[state.lang].visibilityFriends;
      visBtns[2].textContent = i18n[state.lang].visibilityPublic;
    }
  }

  // Add Choice Bottom Sheet
  const addChSheet = document.getElementById("addChoiceSheet");
  if (addChSheet) {
    const spaceLabel = document.getElementById("addChoiceSpaceLabel");
    if (spaceLabel) spaceLabel.textContent = i18n[state.lang].addChoiceSpaceLabel;
    
    const heading = document.getElementById("addChoiceHeading");
    if (heading) heading.textContent = i18n[state.lang].addChoiceHeading;
    
    const collTitle = document.getElementById("choiceAddCollectionTitle");
    if (collTitle) collTitle.textContent = i18n[state.lang].choiceAddCollectionTitle;
    
    const collDesc = document.getElementById("choiceAddCollectionDesc");
    if (collDesc) collDesc.textContent = i18n[state.lang].choiceAddCollectionDesc;
    
    const itemTitle = document.getElementById("choiceAddItemTitle");
    if (itemTitle) itemTitle.textContent = i18n[state.lang].choiceAddItemTitle;
    
    const itemDesc = document.getElementById("choiceAddItemDesc");
    if (itemDesc) {
      const coll = activeCollection();
      itemDesc.textContent = i18n[state.lang].choiceAddItemDesc.replace("{name}", coll ? coll.title : "");
    }
  }

  // 4. Batch Bar
  const cancelBtn = document.getElementById("batchCancelBtn");
  if (cancelBtn) cancelBtn.textContent = state.lang === 'zh' ? '取消' : 'Cancel';
  const deleteBtn = document.getElementById("batchDeleteBtn");
  if (deleteBtn) deleteBtn.textContent = state.lang === 'zh' ? '删除' : 'Delete';

  // 4.5 Settings Screen Translation
  const prefTitle = document.getElementById("settingsPreferencesTitle");
  if (prefTitle) prefTitle.textContent = i18n[state.lang].settingsPreferences;

  const langLabel = document.getElementById("settingsLanguageLabel");
  if (langLabel) langLabel.textContent = i18n[state.lang].settingsLanguageLabel;

  const langDesc = document.getElementById("settingsLanguageDesc");
  if (langDesc) langDesc.textContent = i18n[state.lang].settingsLanguageDesc;

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText("settingsDataTitle", i18n[state.lang].settingsData);
  setText("settingsExportLabel", i18n[state.lang].settingsExportLabel);
  setText("settingsExportDesc", i18n[state.lang].settingsExportDesc);
  setText("settingsClearLabel", i18n[state.lang].settingsClearLabel);
  setText("settingsClearDesc", i18n[state.lang].settingsClearDesc);

  // Edit-profile sheet + confirm dialog
  setText("editProfileKicker", i18n[state.lang].profileEditKicker);
  setText("editProfileHeading", i18n[state.lang].profileEditHeading);
  setText("editProfileNameLabel", i18n[state.lang].profileNameLabel);
  setText("editProfileBioLabel", i18n[state.lang].profileBioLabel);
  setText("changeAvatarBtn", i18n[state.lang].profileChangePhoto);
  setText("removeAvatarBtn", i18n[state.lang].profileRemovePhoto);
  setText("saveProfileBtn", i18n[state.lang].profileSaveBtn);
  const nameInput = document.getElementById("editProfileName");
  if (nameInput) nameInput.placeholder = i18n[state.lang].profileNamePlaceholder;
  const bioInput = document.getElementById("editProfileBio");
  if (bioInput) bioInput.placeholder = i18n[state.lang].profileBioPlaceholder;
  setText("confirmTitle", i18n[state.lang].confirmClearTitle);
  setText("confirmMessage", i18n[state.lang].confirmClearMessage);
  setText("confirmCancelBtn", i18n[state.lang].confirmCancel);
  setText("confirmOkBtn", i18n[state.lang].confirmClearBtn);

  // Profile card reflects the stored profile (falls back to localized defaults)
  updateSettingsProfile(dbService.currentUser);

  // 5. Update header kicker/title for current screen
  setScreen(state.screen);

  // 6. Rerender dynamic lists
  renderCollections();
  renderActiveCollection();
}

function activeCollection() {
  return collections.find((collection) => collection.id === state.collectionId) || collections[0];
}

function selectedItem() {
  return items.find((item) => item.id === state.selectedItemId) || items[0];
}

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function getTodayLabel() {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date());
}

function formatDateLabel(dateStr) {
  if (!dateStr) return getTodayLabel();
  const parts = dateStr.split("-").map(Number);
  if (parts.length < 3) return getTodayLabel();
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(dateObj);
}

function parseDateLabelToISO(label) {
  if (!label) return getISODate();
  const d = new Date(label);
  if (isNaN(d.getTime())) return getISODate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getISODate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatRating(item) {
  return item.rating == null ? (state.lang === 'zh' ? '暂无评分' : 'Not rated yet') : `${item.rating.toFixed(1)}/10`;
}

function setScreen(screen) {
  state.previousScreen = state.screen;
  state.screen = screen;
  document.querySelectorAll(".screen").forEach((screenNode) => {
    screenNode.classList.toggle("is-active", screenNode.dataset.screen === screen);
  });
  
  const isAuthScreen = screen === "auth";
  const isCollectionScreen = screen === "collection";
  editCollectionBtn.classList.toggle("is-hidden", !isCollectionScreen);

  if (isAuthScreen) {
    // Auth screen: hide all chrome
    screenTitle.textContent = "";
    screenKicker.textContent = "";
    screenKicker.style.display = "none";
    if (backButton) backButton.classList.add("is-hidden");
    if (settingsButton) settingsButton.classList.add("is-hidden");
    if (window.floatingAddBtn) floatingAddBtn.classList.add("is-hidden");
    return;
  }

  if (isCollectionScreen) {
    const collection = activeCollection();
    screenTitle.textContent = collection ? collection.title : "";
    screenKicker.textContent = "";
    screenKicker.style.display = "none";
  } else {
    if (state.batchMode) {
      state.batchMode = false;
      state.selectedItems.clear();
      batchBar.classList.add("is-hidden");
    }
    const [title, kicker] = getScreenLabels(screen);
    screenTitle.textContent = title;
    screenKicker.textContent = kicker;
    screenKicker.style.display = kicker ? "" : "none";
  }
  
  if (backIcon) backIcon.textContent = "‹";
  if (backButton) backButton.classList.toggle("is-hidden", screen !== "settings" && screen !== "collection");
  if (settingsButton) settingsButton.classList.toggle("is-hidden", screen === "settings" || screen === "collection");
  
  const isSettings = screen === "settings";
  if (window.floatingAddBtn) floatingAddBtn.classList.toggle("is-hidden", isSettings);
}

function getCollectionItems(collectionId) {
  return items.filter(item => item.collectionId === collectionId);
}

// Single source of truth: a collection's count is always how many items it has.
// Keeps home-card counts, stickers, and the detail header in sync automatically.
function syncCollectionCounts() {
  collections.forEach(c => {
    c.count = items.filter(item => item.collectionId === c.id).length;
  });
}

function renderCollections() {
  collectionGrid.innerHTML = "";

  syncCollectionCounts();
  const n = collections.length;
  const totalItems = collections.reduce((s, c) => s + c.count, 0);

  // ── Check holistic view mode ───────────────────────
  if (state.holisticView) {
    renderHolisticGrid();
    return;
  }

  // Sort collections by count in ascending order (most collected is last, drawn at the front of the stack)
  const sortedCollections = [...collections].sort((a, b) => a.count - b.count);

  // ── Accordion List ──────────────────────────────────
  const accordionList = document.createElement("div");
  accordionList.className = "accordion-list";

  sortedCollections.forEach((collection) => {
    const collectionItems = getCollectionItems(collection.id);
    const stickerCount = Math.min(collection.count, 6);
    // Real photos first, so uploaded items replace the gradient placeholders.
    const stickers = [...collectionItems]
      .sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0))
      .slice(0, stickerCount);

    const card = document.createElement("div");
    card.className = "deck-card";
    card.dataset.id = collection.id;
    card.style.setProperty("--accent", collection.accent);

    let stickerHTML = "";
    if (stickers.length === 0) {
      stickerHTML = `<div class="deck-sticker-empty"><img src="empty.png" alt="Empty collection" /></div>`;
    } else {
      const deckRotations = [-8, 6, -4, 8, -5, 7];
      stickerHTML = stickers.map((item, i) => {
        const overlap = stickers.length === 1 ? 0 : 28;
        const x = (i - (stickers.length - 1) / 2) * overlap;
        const y = 0;
        const rot = stickers.length === 1 ? 0 : (deckRotations[i] || 0);
        if (item.image) {
          return `<div class="deck-sticker has-image" style="--sx:${x}px;--sy:${y}px;--srot:${rot}deg;--si:${i};z-index:${stickers.length - i}">
            <img src="${item.image}" alt="${item.title}" />
          </div>`;
        }
        return `<div class="deck-sticker" style="--sx:${x}px;--sy:${y}px;--srot:${rot}deg;--si:${i};--art:${item.art};z-index:${stickers.length - i}">
          <div class="deck-sticker-art"></div>
        </div>`;
      }).join("");
    }

    card.innerHTML = `
      <div class="deck-card-inner">
        <div class="deck-card-bottom" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
          <div style="flex: 1;">
            <h3 class="deck-card-title" style="margin-bottom: 4px;">${collection.title}</h3>
            <p class="deck-card-desc" style="margin-bottom: 0;">${collection.description || (state.lang === 'zh' ? '暂无描述' : 'No description')}</p>
          </div>
          <span class="deck-card-count" style="flex-shrink: 0; margin-top: 2px;">${collection.count} ${collection.count === 1 ? i18n[state.lang].itemsCountSingle : i18n[state.lang].itemsCount}</span>
        </div>
        <div class="deck-card-top">
          <div class="deck-sticker-cluster" aria-hidden="true">${stickerHTML}</div>
        </div>
      </div>
    `;

    // Tap anywhere on the card to open it
    card.addEventListener("click", () => {
      state.collectionId = collection.id;
      renderActiveCollection();
      setScreen("collection");
    });

    accordionList.appendChild(card);
  });

  collectionGrid.appendChild(accordionList);

  // ── Summary card ───────────────────────────────────
  const summaryCard = document.createElement("div");
  summaryCard.className = "deck-summary";
  const sortedByDate = [...items].sort((a, b) => {
    const da = Date.parse(a.added) || 0;
    const db = Date.parse(b.added) || 0;
    return db - da;
  });
  const lastCollected = sortedByDate[0];
  const lastCollectedName = lastCollected && lastCollected.title ? lastCollected.title : (state.lang === 'zh' ? '暂无' : '—');
  summaryCard.innerHTML = `
    <div class="deck-summary-stats">
      <div class="deck-stat">
        <span class="deck-stat-value">${n}</span>
        <span class="deck-stat-label">${i18n[state.lang].summaryCollections}</span>
      </div>
      <div class="deck-stat">
        <span class="deck-stat-value">${totalItems}</span>
        <span class="deck-stat-label">${i18n[state.lang].summaryTotalItems}</span>
      </div>
      <div class="deck-stat deck-stat--last">
        <span class="deck-stat-value deck-stat-value--name" title="${lastCollectedName}">${lastCollectedName}</span>
        <span class="deck-stat-label">${i18n[state.lang].summaryLastCollected}</span>
      </div>
    </div>
    <div class="deck-summary-actions">
      <button class="deck-see-all-btn" id="deckSeeAllBtn" type="button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
        </svg>
        ${i18n[state.lang].seeAll}
      </button>
      <button class="deck-new-collection-btn" id="deckNewCollectionBtn" type="button">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        ${i18n[state.lang].newCollection}
      </button>
    </div>
  `;

  collectionGrid.appendChild(summaryCard);

  // See All toggle
  document.getElementById("deckSeeAllBtn").addEventListener("click", () => {
    state.holisticView = true;
    renderCollections();
  });

  // New Collection — open bottom sheet
  document.getElementById("deckNewCollectionBtn").addEventListener("click", () => {
    openAddCollectionSheet();
  });
}

// ── Holistic grid view ─────────────────────────────────
function renderHolisticGrid() {
  collectionGrid.innerHTML = "";

  const backRow = document.createElement("div");
  backRow.className = "holistic-back-row";
  backRow.innerHTML = `
    <button class="holistic-back-btn" id="holisticBackBtn" type="button">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      ${i18n[state.lang].backToDeck}
    </button>
  `;
  collectionGrid.appendChild(backRow);

  const grid = document.createElement("div");
  grid.className = "holistic-grid";

  collections.forEach((collection, idx) => {
    const collectionItems = getCollectionItems(collection.id);
    const holStickerCount = Math.min(collection.count, 6);
    const stickers = [...collectionItems]
      .sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0))
      .slice(0, holStickerCount);

    const card = document.createElement("button");
    card.type = "button";
    card.className = "holistic-card";
    
    // Extract base color from gradient string and set RGB variable for custom border & inner glow
    const hexMatch = collection.accent.match(/#[0-9a-fA-F]{6}/);
    const baseColor = hexMatch ? hexMatch[0] : "#0a58ff";
    const cleanHex = baseColor.replace("#", "");
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    card.style.setProperty("--accent-rgb", `${r}, ${g}, ${b}`);
    card.style.setProperty("--delay", `${idx * 60}ms`);

    const holRotations = [-8, 6, -4, 8, -5, 7];
    const stickerHTML = stickers.map((item, i) => {
      const overlap = stickers.length === 1 ? 0 : 18;
      const x = (i - (stickers.length - 1) / 2) * overlap;
      const y = 0;
      const rot = stickers.length === 1 ? 0 : (holRotations[i] || 0);
      if (item.image) {
        return `<div class="hol-sticker has-image" style="--hx:${x}px;--hy:${y}px;--hrot:${rot}deg;z-index:${stickers.length - i}"><img src="${item.image}" alt="" /></div>`;
      }
      return `<div class="hol-sticker" style="--hx:${x}px;--hy:${y}px;--hrot:${rot}deg;--art:${item.art};z-index:${stickers.length - i}"><div class="hol-sticker-art"></div></div>`;
    }).join("");

    card.innerHTML = `
      <div class="hol-card-top">${stickerHTML}</div>
      <div class="hol-card-bottom">
        <h4>${collection.title}</h4>
        <span>${collection.count}</span>
      </div>
    `;

    card.addEventListener("click", () => {
      state.collectionId = collection.id;
      state.holisticView = false;
      renderActiveCollection();
      setScreen("collection");
    });

    grid.appendChild(card);
  });

  collectionGrid.appendChild(grid);

  document.getElementById("holisticBackBtn").addEventListener("click", () => {
    state.holisticView = false;
    renderCollections();
  });
}

function renderActiveCollection() {
  const collection = activeCollection();
  if (state.screen === "collection") {
    screenTitle.textContent = collection ? collection.title : "";
    screenKicker.textContent = "";
    screenKicker.style.display = "none";
  }
  renderItems();
  renderFilters();
}

function tagTone(index) {
  const tones = ["#0a58ff", "#36c878", "#ff7a3d", "#ff5e8a", "#7a67ff", "#10a7a7"];
  return tones[index % tones.length];
}

function getAllTags() {
  return [...new Set(items.flatMap((item) => item.tags))].sort();
}

function renderFilters() {
  const allTags = getAllTags();
  if (allTags.length === 0) {
    tagsTray.innerHTML = `<span class="control-label" style="padding: 6px 12px; text-transform: none;">No tags added yet</span>`;
    return;
  }
  tagsTray.innerHTML = allTags
    .map(
      (tag) =>
        `<button class="${state.activeTag === tag ? "is-active" : ""}" data-tag="${tag}" type="button">${tag}</button>`
    )
    .join("");
}

function getVisibleItems() {
  const query = state.search.toLowerCase().trim();
  let filtered = items.filter((item) => {
    if (item.collectionId !== state.collectionId) return false;
    // Search query match
    const matchesSearch =
      !query ||
      [item.title, item.note, item.added, item.status, item.tags.join(" "), Object.values(item.meta).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(query);

    // Status filter match
    let matchesStatus = true;
    if (state.status === "owned") matchesStatus = item.status === "Owned";
    if (state.status === "wishlist") matchesStatus = item.status === "Wishlist";

    // Active tag filter match
    let matchesTag = true;
    if (state.activeTag) matchesTag = item.tags.includes(state.activeTag);

    return matchesSearch && matchesStatus && matchesTag;
  });

  // Sorting
  if (state.sort !== "custom") {
    filtered.sort((a, b) => {
      if (state.sort === "rating-high") {
        const valA = a.rating != null ? a.rating : -1;
        const valB = b.rating != null ? b.rating : -1;
        return valB - valA;
      }
      if (state.sort === "rating-low") {
        const valA = a.rating != null ? a.rating : 999;
        const valB = b.rating != null ? b.rating : 999;
        return valA - valB;
      }
      if (state.sort === "added-new") {
        const dateA = Date.parse(a.added) || Date.now();
        const dateB = Date.parse(b.added) || Date.now();
        return dateB - dateA;
      }
      if (state.sort === "added-old") {
        const dateA = Date.parse(a.added) || Date.now();
        const dateB = Date.parse(b.added) || Date.now();
        return dateA - dateB;
      }
      return 0;
    });
  }

  return filtered;
}

function renderItems() {
  itemsView.innerHTML = "";
  itemsView.className = `items-view ${state.view}-view`;
  const collectionItems = getCollectionItems(state.collectionId);
  const visibleItems = getVisibleItems();
  
  if (!collectionItems.length) {
    itemsView.innerHTML = `
      <div class="empty-state-view">
        <img src="empty.png" class="empty-state-img" alt="Empty collection" />
        <h4>${state.lang === 'zh' ? '暂无单品' : 'Empty collection'}</h4>
        <p>${state.lang === 'zh' ? '该收藏夹中还没有添加任何单品。点击右下角的 ＋ 按钮开始添加吧！' : 'There are no items in this collection yet. Tap the floating + button to add one!'}</p>
      </div>
    `;
    return;
  }
  
  if (!visibleItems.length) {
    itemsView.innerHTML = `<article class="item-card empty-card"><h4>No matches</h4><p>Try another rating, added time, or tag filter.</p></article>`;
    return;
  }

  visibleItems.forEach((item) => {
    const card = document.createElement("div");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    
    let cardClass = `item-card ${item.status === "Wishlist" ? "is-wishlist" : "is-owned"}`;
    if (state.batchMode) {
      cardClass += " is-selecting";
      if (state.selectedItems.has(item.id)) {
        cardClass += " is-selected";
      }
    }
    card.className = cardClass;
    
    card.dataset.added = item.added;
    card.innerHTML = `
      <div class="item-image object-cutout ${item.image ? "has-image" : "has-placeholder"}" style="--art: ${item.art}">
        ${item.image ? `<img src="${item.image}" alt="${item.title}" />` : `<img src="No photo.png" class="item-placeholder-img" alt="No photo" />`}
      </div>
      <div>
        <span class="status-badge">${item.status}</span>
        <h4>${item.title}</h4>
        <p>${item.note}</p>
        <div class="item-meta">
          <span>${formatRating(item)}</span>
          <span>${item.added}</span>
          ${item.tags.map((tag) => `<span>${tag}</span>`).join("")}
        </div>
      </div>
      ${state.batchMode ? `<div class="item-card-checkbox-container"><input type="checkbox" class="item-card-checkbox" ${state.selectedItems.has(item.id) ? "checked" : ""} tabindex="-1" /></div>` : ""}
    `;
    
    card.addEventListener("click", (e) => {
      if (state.batchMode) {
        const checkbox = card.querySelector(".item-card-checkbox");
        if (checkbox) {
          // If clicked the checkbox itself, its state has already been toggled in the DOM.
          // Otherwise, toggle it manually.
          if (e.target !== checkbox && !checkbox.contains(e.target)) {
            checkbox.checked = !checkbox.checked;
          }
          
          if (checkbox.checked) {
            state.selectedItems.add(item.id);
            card.classList.add("is-selected");
          } else {
            state.selectedItems.delete(item.id);
            card.classList.remove("is-selected");
          }
        }
        
        batchCountText.textContent = state.lang === 'zh'
          ? `已选择 ${state.selectedItems.size} 件单品`
          : `${state.selectedItems.size} item(s) selected`;
      } else {
        state.selectedItemId = item.id;
        renderItemDetail();
        openDetailSheet();
      }
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        card.click();
      }
    });

    itemsView.appendChild(card);
  });
}

function renderItemDetail() {
  const item = selectedItem();

  const metaHTML = Object.entries(item.meta)
    .filter(([key, value]) => value && value !== "Not set" && value !== "Personal")
    .map(([key, value]) => `<div><span>${key}</span><strong>${value}</strong></div>`)
    .join("");

  itemDetail.innerHTML = `
    <div class="sheet-title">
      <div>
        <p class="micro-label">Item detail</p>
        <h3>${item.title}</h3>
      </div>
      <button class="small-pill" id="editItemBtn" type="button" style="margin-right: 32px;">Edit</button>
    </div>
    <div class="detail-hero">
      <div class="detail-object object-cutout ${item.image ? "has-image" : "has-placeholder"}" style="--art: ${item.art}">
        ${item.image ? `<img src="${item.image}" alt="${item.title}" />` : `<img src="No photo.png" class="item-placeholder-img" alt="No photo" />`}
      </div>
    </div>
    <div class="detail-title-row">
      <div>
        <p class="micro-label">${item.status} • ${item.added}</p>
        <h4>${item.title}</h4>
      </div>
      <span>${formatRating(item)}</span>
    </div>
    ${item.note ? `<p class="detail-note">${item.note}</p>` : ""}
    <div class="detail-tags">${item.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
    ${metaHTML ? `<div class="detail-meta">${metaHTML}</div>` : ""}
  `;

  document.querySelector("#editItemBtn").addEventListener("click", () => {
    renderItemEditForm(item);
    itemDetail.classList.add("is-hidden");
    itemDetailEdit.classList.remove("is-hidden");
  });
}

function parsePriceAndCurrency(priceStr) {
  if (!priceStr) return { currency: "€", amount: "" };
  const clean = priceStr.trim();
  const firstChar = clean.charAt(0);
  const symbols = ["€", "$", "£", "¥"];
  if (symbols.includes(firstChar)) {
    return { currency: firstChar, amount: clean.slice(1).trim() };
  }
  return { currency: "€", amount: clean };
}

function renderItemEditForm(item) {
  state.editDraftTags = [...item.tags];
  state.editExtractedImage = item.image || "";
  const { currency, amount } = parsePriceAndCurrency(item.meta.Price);
  
  itemDetailEdit.innerHTML = `
    <div class="sheet-title">
      <div>
        <p class="micro-label">${state.lang === 'zh' ? '编辑单品' : 'Edit item'}</p>
        <h3 id="editSheetHeaderTitle">${item.title}</h3>
      </div>
    </div>
    <div class="photo-uploader ${state.editExtractedImage ? "is-extracted" : ""}" id="editPhotoUploader" style="position: relative;">
      <div class="extracted-object ${state.editExtractedImage ? "has-image" : ""}" id="editExtractedObject">
        ${state.editExtractedImage ? `<img src="${state.editExtractedImage}" alt="Extracted item preview" />` : `<img src="Logo.png" class="uploader-placeholder-img" alt="Placeholder" />`}
      </div>
      <span id="editPhotoStatus">
        ${state.editExtractedImage 
          ? (state.lang === 'zh' ? "照片提取轮廓成功" : "Photo extracted with outline") 
          : (state.lang === 'zh' ? "未选择照片" : "No photo selected")}
      </span>
      <div class="photo-actions">
        <button id="editPhotoCameraBtn" type="button">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          ${state.lang === 'zh' ? '拍照' : 'Camera'}
        </button>
        <button id="editPhotoAlbumBtn" type="button">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
          ${state.lang === 'zh' ? '相册' : 'Photo album'}
        </button>
      </div>
      <input id="editAlbumInput" type="file" accept="image/*" hidden />
      <input id="editCameraInput" type="file" accept="image/*" capture="environment" hidden />
    </div>

    <label>
      <span>${state.lang === 'zh' ? '名称' : 'Title'}</span>
      <input id="editItemTitle" maxlength="42" value="${item.title}" />
    </label>

    <div class="form-grid">
      <label>
        <span>${state.lang === 'zh' ? '评分 1-10' : 'Rating 1-10'}</span>
        <input id="editItemRating" type="number" inputmode="decimal" min="1" max="10" step="0.1" value="${item.rating || ""}" ${item.status === "Wishlist" ? "disabled" : ""} />
      </label>
      <label>
        <span>${state.lang === 'zh' ? '状态' : 'Status'}</span>
        <select id="editItemStatus">
          <option value="Owned" ${item.status === "Owned" ? "selected" : ""}>${state.lang === 'zh' ? '已拥有' : 'Owned'}</option>
          <option value="Wishlist" ${item.status === "Wishlist" ? "selected" : ""}>${state.lang === 'zh' ? '心愿单' : 'Wishlist'}</option>
        </select>
      </label>
    </div>

    <div class="form-grid">
      <label>
        <span>${state.lang === 'zh' ? '添加日期' : 'Date added'}</span>
        <input id="editItemDate" type="date" value="${parseDateLabelToISO(item.added)}" />
      </label>
      <label>
        <span>${state.lang === 'zh' ? '价格 (可选)' : 'Price optional'}</span>
        <div style="display: flex; gap: 8px;">
          <select id="editItemCurrency" class="currency-select">
            <option value="€" ${currency === "€" ? "selected" : ""}>€</option>
            <option value="$" ${currency === "$" ? "selected" : ""}>$</option>
            <option value="£" ${currency === "£" ? "selected" : ""}>£</option>
            <option value="¥" ${currency === "¥" ? "selected" : ""}>¥</option>
          </select>
          <input id="editItemPrice" inputmode="decimal" placeholder="3.20" value="${amount}" style="flex: 1;" />
        </div>
      </label>
    </div>

    <label>
      <span>${state.lang === 'zh' ? '稀有度 (可选)' : 'Rarity optional'}</span>
      <input id="editItemRarity" placeholder="Limited, Core, Regional" value="${item.meta.Rarity || ""}" />
    </label>

    <label>
      <span>${state.lang === 'zh' ? '备注 (可选)' : 'Memory note'}</span>
      <textarea id="editItemNote" rows="3">${item.note || ""}</textarea>
    </label>

    <label>
      <span>${state.lang === 'zh' ? '编辑标签' : 'Edit tags'}</span>
      <div class="tag-input-row">
        <input id="editTagInput" placeholder="${state.lang === 'zh' ? '输入标签' : 'Type a tag'}" />
        <button id="editAddTagBtn" class="secondary-btn" type="button">${state.lang === 'zh' ? '添加' : 'Add'}</button>
      </div>
    </label>
    <div class="tag-editor" id="editTagEditor" style="margin-top: -8px;"></div>

    <div class="form-actions" style="display: flex; gap: 16px; margin-top: 8px;">
      <button class="secondary-btn" id="cancelEditItemBtn" type="button" style="flex: 1; width: 100%;">${state.lang === 'zh' ? '取消' : 'Cancel'}</button>
      <button class="primary-action" id="saveEditItemBtn" type="submit" style="flex: 1; width: 100%; margin-top: 0;">${state.lang === 'zh' ? '保存修改' : 'Save Changes'}</button>
    </div>
  `;

  // Bind tag rendering
  renderEditTags();

  // Status Change logic: disable rating if Wishlist
  const editStatusSelect = document.querySelector("#editItemStatus");
  const editRatingInput = document.querySelector("#editItemRating");
  editStatusSelect.addEventListener("change", () => {
    const isWish = editStatusSelect.value === "Wishlist";
    editRatingInput.disabled = isWish;
    editRatingInput.value = isWish ? "" : editRatingInput.value || "8.7";
    editRatingInput.placeholder = isWish ? (state.lang === 'zh' ? "拥有后评分" : "After owned") : "8.7";
  });

  // Tag interactions
  const editTagInput = document.querySelector("#editTagInput");
  const editAddTagBtn = document.querySelector("#editAddTagBtn");
  
  function addEditTag() {
    const tag = editTagInput.value.trim().toLowerCase();
    if (tag && !state.editDraftTags.includes(tag)) {
      state.editDraftTags.push(tag);
      renderEditTags();
    }
    editTagInput.value = "";
  }
  
  editAddTagBtn.addEventListener("click", addEditTag);
  editTagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addEditTag();
    }
  });

  // Photo handlers
  const editPhotoCameraBtn = document.querySelector("#editPhotoCameraBtn");
  const editPhotoAlbumBtn = document.querySelector("#editPhotoAlbumBtn");
  const editCameraInput = document.querySelector("#editCameraInput");
  const editAlbumInput = document.querySelector("#editAlbumInput");

  editPhotoCameraBtn.addEventListener("click", () => {
    state.editPhotoSource = "camera";
    editCameraInput.click();
  });
  editPhotoAlbumBtn.addEventListener("click", () => {
    state.editPhotoSource = "album";
    editAlbumInput.click();
  });

  async function handleEditPhotoFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const statusEl = document.querySelector("#editPhotoStatus");
    const previewEl = document.querySelector("#editExtractedObject");
    const uploaderEl = document.querySelector("#editPhotoUploader");
    
    if (statusEl) statusEl.textContent = state.lang === 'zh' ? "正在提取主体..." : "Extracting object...";
    try {
      const dataUrl = await extractObjectFromImage(file);
      state.editExtractedImage = dataUrl;
      if (previewEl) {
        previewEl.innerHTML = `<img src="${dataUrl}" alt="Extracted item preview" />`;
        previewEl.classList.add("has-image");
        previewEl.classList.toggle("from-camera", state.editPhotoSource === "camera");
      }
      if (uploaderEl) {
        uploaderEl.classList.add("is-extracted");
      }
      if (statusEl) {
        statusEl.textContent = state.editPhotoSource === "camera"
          ? (state.lang === 'zh' ? "照片提取轮廓成功" : "Camera photo extracted with outline")
          : (state.lang === 'zh' ? "照片提取轮廓成功" : "Album photo extracted with outline");
      }
    } catch {
      if (statusEl) {
        statusEl.textContent = state.lang === 'zh' ? "无法提取此照片。请尝试其他图片。" : "Could not extract this photo. Try another image.";
      }
    }
  }

  editCameraInput.addEventListener("change", handleEditPhotoFile);
  editAlbumInput.addEventListener("change", handleEditPhotoFile);

  // Cancel button
  document.querySelector("#cancelEditItemBtn").addEventListener("click", () => {
    itemDetailEdit.classList.add("is-hidden");
    itemDetail.classList.remove("is-hidden");
  });

  // Submit form handler
  itemDetailEdit.onsubmit = (event) => {
    event.preventDefault();
    const titleVal = document.querySelector("#editItemTitle").value.trim() || "Untitled item";
    const statusVal = editStatusSelect.value;
    const isWish = statusVal === "Wishlist";
    const ratingVal = isWish ? null : Math.max(1, Math.min(10, Number(editRatingInput.value) || 1));
    const priceAmount = document.querySelector("#editItemPrice").value.trim();
    const currencySymbol = document.querySelector("#editItemCurrency")?.value || "€";
    const priceVal = priceAmount ? `${currencySymbol}${priceAmount}` : "";
    const rarityVal = document.querySelector("#editItemRarity").value.trim();
    const noteVal = document.querySelector("#editItemNote").value.trim();
    const dateVal = document.querySelector("#editItemDate").value;

    // Update the item
    item.title = titleVal;
    item.status = statusVal;
    item.rating = ratingVal;
    item.note = noteVal;
    item.added = formatDateLabel(dateVal);
    item.meta.Price = priceVal;
    item.meta.Rarity = rarityVal;
    item.tags = [...state.editDraftTags];
    item.image = state.editExtractedImage;

    // Refresh UI
    renderItems();
    renderFilters();
    renderItemDetail();
    
    // Switch view
    itemDetailEdit.classList.add("is-hidden");
    itemDetail.classList.remove("is-hidden");
    
    showToast(`${titleVal} updated`);

    // Persist data
    persistData();
  };
}

function renderEditTags() {
  const tagEditor = document.querySelector("#editTagEditor");
  if (!tagEditor) return;
  tagEditor.innerHTML = "";
  state.editDraftTags.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${tag} ×`;
    button.addEventListener("click", () => {
      state.editDraftTags = state.editDraftTags.filter((t) => t !== tag);
      renderEditTags();
    });
    tagEditor.appendChild(button);
  });
}



function renderTags() {
  tagEditor.innerHTML = "";
  state.draftTags.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${tag} ×`;
    button.addEventListener("click", () => {
      state.draftTags = state.draftTags.filter((item) => item !== tag);
      renderTags();
    });
    tagEditor.appendChild(button);
  });
}

function syncStatusFields() {
  const isWishlist = itemStatus.value === "Wishlist";
  itemRating.disabled = isWishlist;
  itemRating.value = isWishlist ? "" : itemRating.value || "8.7";
  itemRating.placeholder = isWishlist ? "After owned" : "8.7";
}

function openAddSheet() {
  sheetBackdrop.hidden = false;
  addSheet.setAttribute("aria-hidden", "false");
  addSheet.classList.add("is-open");
  if (window.floatingAddBtn) {
    floatingAddBtn.classList.add("is-hidden");
  }
  
  // Populate collection selection select box
  const selectEl = document.getElementById("itemCollectionSelect");
  if (selectEl) {
    const isCollectionDetail = state.screen === "collection";
    const optionsHTML = collections.map(col => {
      const isSelected = isCollectionDetail && col.id === state.collectionId;
      return `<option value="${col.id}" ${isSelected ? "selected" : ""}>${col.title}</option>`;
    });
    
    if (!isCollectionDetail) {
      optionsHTML.unshift(`<option value="" disabled selected>${i18n[state.lang].selectCollectionPlaceholder}</option>`);
    }
    
    selectEl.innerHTML = optionsHTML.join("");
  }
  
  // Reset the form and draft tags to default state on open
  addItemForm.reset();
  state.draftTags = [];
  renderTags();
  itemDate.value = getISODate();
  state.extractedImage = "";
  extractedObject.innerHTML = `<img src="Logo.png" class="uploader-placeholder-img" alt="Placeholder" />`;
  extractedObject.classList.remove("has-image");
  
  const uploader = document.querySelector("#photoUploader");
  if (uploader) uploader.classList.remove("is-extracted");
  
  photoStatus.textContent = "Object extracted with outline";
  syncStatusFields();
}

function openDetailSheet() {
  sheetBackdrop.hidden = false;
  detailSheet.setAttribute("aria-hidden", "false");
  detailSheet.classList.add("is-open");
  if (window.floatingAddBtn) {
    floatingAddBtn.classList.add("is-hidden");
  }
  itemDetail.classList.remove("is-hidden");
  itemDetailEdit.classList.add("is-hidden");
}

function closeSheets() {
  addSheet.classList.remove("is-open");
  detailSheet.classList.remove("is-open");
  editCollectionSheet.classList.remove("is-open");
  if (window.addCollectionSheet) {
    addCollectionSheet.classList.remove("is-open");
    addCollectionSheet.setAttribute("aria-hidden", "true");
  }
  if (window.addChoiceSheet) {
    addChoiceSheet.classList.remove("is-open");
    addChoiceSheet.setAttribute("aria-hidden", "true");
  }
  if (window.editProfileSheet) {
    editProfileSheet.classList.remove("is-open");
    editProfileSheet.setAttribute("aria-hidden", "true");
  }
  addSheet.setAttribute("aria-hidden", "true");
  detailSheet.setAttribute("aria-hidden", "true");
  editCollectionSheet.setAttribute("aria-hidden", "true");
  sheetBackdrop.hidden = true;
  if (window.floatingAddBtn) {
    const isSettings = state.screen === "settings";
    floatingAddBtn.classList.toggle("is-hidden", isSettings);
  }
}

function resetFilters() {
  state.status = "all";
  state.sort = "added-new";
  state.activeTag = null;
  state.search = "";
  searchInput.value = "";

  sortSelect.value = "added-new";
  statusSegmented.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.status === "all");
  });

  tagsToggleBtn.classList.remove("is-active");
  tagsTray.classList.add("is-collapsed");
  tagsTray.querySelectorAll("button").forEach((btn) => {
    btn.classList.remove("is-active");
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
}


document.querySelectorAll(".icon-segmented button").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    document.querySelectorAll(".icon-segmented button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    renderItems();
  });
});

sortSelect.addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderItems();
});

statusSegmented.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  state.status = button.dataset.status;
  statusSegmented.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("is-active", btn === button);
  });
  renderItems();
});

tagsToggleBtn.addEventListener("click", () => {
  tagsToggleBtn.classList.toggle("is-active");
  tagsTray.classList.toggle("is-collapsed");
});

tagsTray.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (state.activeTag === button.dataset.tag) {
    state.activeTag = null;
    button.classList.remove("is-active");
  } else {
    state.activeTag = button.dataset.tag;
    tagsTray.querySelectorAll("button").forEach((btn) => {
      btn.classList.toggle("is-active", btn === button);
    });
  }
  renderItems();
});

searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderItems();
});

if (backButton) {
  backButton.addEventListener("click", () => {
    if (state.screen === "settings" || state.screen === "collection") {
      setScreen("collections");
    }
  });
}

if (settingsButton) {
  settingsButton.addEventListener("click", () => {
    setScreen("settings");
  });
}

const languageSegmented = document.getElementById("languageSegmented");
if (languageSegmented) {
  // Set initial active state based on state.lang
  languageSegmented.querySelectorAll("button").forEach(b => {
    b.classList.toggle("is-active", b.dataset.lang === state.lang);
  });
  
  languageSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const lang = btn.dataset.lang;
    if (lang === state.lang) return;
    state.lang = lang;
    
    languageSegmented.querySelectorAll("button").forEach(b => {
      b.classList.toggle("is-active", b.dataset.lang === lang);
    });

    try {
      localStorage.setItem("app_lang", lang);
    } catch (err) {}

    updateLanguage();
    showToast(i18n[lang].toastLangChanged);
  });
}

// ════════════════════════════════════════════════════════
// Edit Profile — avatar + personal info (Local Mode)
// ════════════════════════════════════════════════════════
const editProfileBtn = document.getElementById("editProfileBtn");
const editProfileSheet = document.getElementById("editProfileSheet");
const editProfileForm = document.getElementById("editProfileForm");
const avatarInput = document.getElementById("avatarInput");
const profileAvatarPreview = document.getElementById("profileAvatarPreview");

// Pending avatar while the edit sheet is open (null = removed, undefined = unchanged)
let pendingAvatar;

function openEditProfileSheet() {
  const profile = getProfile();
  pendingAvatar = profile.avatar;
  document.getElementById("editProfileName").value = profile.name || "";
  document.getElementById("editProfileBio").value = profile.bio || "";
  applyAvatar(profileAvatarPreview, profile.avatar);

  sheetBackdrop.hidden = false;
  editProfileSheet.setAttribute("aria-hidden", "false");
  editProfileSheet.classList.add("is-open");
  if (window.floatingAddBtn) floatingAddBtn.classList.add("is-hidden");
}

if (editProfileBtn) editProfileBtn.addEventListener("click", openEditProfileSheet);

const closeEditProfileButton = document.getElementById("closeEditProfileButton");
if (closeEditProfileButton) closeEditProfileButton.addEventListener("click", closeSheets);

// Avatar picking
function triggerAvatarPick() { avatarInput.click(); }
if (profileAvatarPreview) profileAvatarPreview.addEventListener("click", triggerAvatarPick);
const changeAvatarBtn = document.getElementById("changeAvatarBtn");
if (changeAvatarBtn) changeAvatarBtn.addEventListener("click", triggerAvatarPick);

const removeAvatarBtn = document.getElementById("removeAvatarBtn");
if (removeAvatarBtn) removeAvatarBtn.addEventListener("click", () => {
  pendingAvatar = null;
  applyAvatar(profileAvatarPreview, null);
});

if (avatarInput) avatarInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    // Downscale to keep localStorage small
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d");
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      pendingAvatar = canvas.toDataURL("image/jpeg", 0.82);
      applyAvatar(profileAvatarPreview, pendingAvatar);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  avatarInput.value = ""; // allow re-picking the same file
});

if (editProfileForm) editProfileForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const profile = getProfile();
  profile.name = document.getElementById("editProfileName").value.trim();
  profile.bio = document.getElementById("editProfileBio").value.trim();
  if (pendingAvatar === null) delete profile.avatar;
  else if (pendingAvatar !== undefined) profile.avatar = pendingAvatar;
  saveProfile(profile);
  renderProfile();
  closeSheets();
  showToast(i18n[state.lang].profileSavedToast);
});

// ════════════════════════════════════════════════════════
// Confirm dialog (generic) — used by Clear Data
// ════════════════════════════════════════════════════════
const confirmBackdrop = document.getElementById("confirmBackdrop");
const confirmModal = document.getElementById("confirmModal");
const confirmOkBtn = document.getElementById("confirmOkBtn");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
let confirmAction = null;

function openConfirm(onConfirm) {
  confirmAction = onConfirm;
  confirmBackdrop.hidden = false;
  confirmModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => confirmModal.classList.add("is-open"));
}

function closeConfirm() {
  confirmModal.classList.remove("is-open");
  confirmModal.setAttribute("aria-hidden", "true");
  confirmBackdrop.hidden = true;
  confirmAction = null;
}

if (confirmCancelBtn) confirmCancelBtn.addEventListener("click", closeConfirm);
if (confirmBackdrop) confirmBackdrop.addEventListener("click", closeConfirm);
if (confirmOkBtn) confirmOkBtn.addEventListener("click", () => {
  const action = confirmAction;
  closeConfirm();
  if (action) action();
});

// ════════════════════════════════════════════════════════
// Clear Data — wipe everything from this browser
// ════════════════════════════════════════════════════════
const clearDataBtn = document.getElementById("clearDataBtn");
if (clearDataBtn) clearDataBtn.addEventListener("click", () => {
  openConfirm(() => {
    ["app_collections", "app_items", "app_profile"].forEach(k => {
      try { localStorage.removeItem(k); } catch {}
    });
    showToast(i18n[state.lang].clearedToast);
    setTimeout(() => window.location.reload(), 700);
  });
});

// ════════════════════════════════════════════════════════
// Export Data — download collections + items as CSV (opens in Excel/Sheets)
// ════════════════════════════════════════════════════════
function csvEscape(val) {
  const s = (val === null || val === undefined) ? "" : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildExportCsv() {
  const colName = {};
  collections.forEach(c => { colName[c.id] = c.title; });

  // Collect every meta key that appears, so nothing is lost
  const metaKeys = [];
  items.forEach(it => Object.keys(it.meta || {}).forEach(k => {
    if (!metaKeys.includes(k)) metaKeys.push(k);
  }));

  const headers = ["Collection", "Item", "Status", "Rating", "Tags", "Note", "Added", ...metaKeys];
  const rows = [headers];

  items.forEach(it => {
    rows.push([
      colName[it.collectionId] || it.collectionId || "",
      it.title || "",
      it.status || "",
      (it.rating === null || it.rating === undefined) ? "" : it.rating,
      (it.tags || []).join(", "),
      it.note || "",
      it.added || "",
      ...metaKeys.map(k => (it.meta && it.meta[k] != null) ? it.meta[k] : ""),
    ]);
  });

  return rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
}

const exportBtn = document.getElementById("exportBtn");
if (exportBtn) exportBtn.addEventListener("click", () => {
  if (!items.length) {
    showToast(i18n[state.lang].exportEmptyToast);
    return;
  }
  const csv = "﻿" + buildExportCsv(); // BOM so Excel reads UTF-8 (incl. Chinese)
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `archive-export-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(i18n[state.lang].exportDoneToast.replace("{n}", items.length));
});

closeSheetButton.addEventListener("click", closeSheets);
closeDetailButton.addEventListener("click", closeSheets);
sheetBackdrop.addEventListener("click", closeSheets);

document.querySelectorAll("[data-photo-source]").forEach((button) => {
  button.addEventListener("click", () => {
    state.photoSource = button.dataset.photoSource;
    const input = state.photoSource === "camera" ? cameraInput : albumInput;
    input.click();
    extractedObject.classList.toggle("from-camera", state.photoSource === "camera");
    photoStatus.textContent =
      state.photoSource === "camera"
        ? "Choose or capture a camera photo"
        : "Choose a photo from album";
  });
});

function addDraftTag() {
  const tag = tagInput.value.trim().toLowerCase();
  if (tag && !state.draftTags.includes(tag)) {
    state.draftTags.push(tag);
    renderTags();
  }
  tagInput.value = "";
}

addTagButton.addEventListener("click", addDraftTag);
tagInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addDraftTag();
});

function extractObjectFromImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      img.addEventListener("load", () => {
        try {
          resolve(isolateSubject(img));
        } catch (err) {
          // Never fail the add flow because of the cut-out — fall back to a plain crop.
          try { resolve(centerCrop(img)); } catch (e) { reject(e); }
        }
      });
      img.addEventListener("error", reject);
      img.src = reader.result;
    });
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}

// Isolate the main subject from a (possibly cluttered) photo:
//   1. Region-grow the background inward from the border — flows around
//      gradients/vignettes but stops at the subject's edge.
//   2. Keep only the single foreground blob with the best area×centredness
//      score, dropping stray clutter elsewhere in the frame.
//   3. Feather the mask edge, then tight-crop to the subject.
// Falls back to a centred square crop when the mask looks unreliable
// (e.g. the subject fills the whole frame or nothing distinct is found).
function isolateSubject(img) {
  const maxSize = 640;
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const N = w * h;

  // ── 1. Region-grow background inward from the border ──
  const isBg = new Uint8Array(N);
  const stack = new Int32Array(N);
  let sp = 0;
  const TOL = 40; // max per-pixel channel-sum difference to count as "same region"
  const seed = (p) => { if (!isBg[p]) { isBg[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + (w - 1)); }
  while (sp > 0) {
    const p = stack[--sp];
    const pi = p * 4;
    const x = p % w;
    const y = (p / w) | 0;
    const tryN = (np) => {
      if (isBg[np]) return;
      const ni = np * 4;
      const dist = Math.abs(d[pi] - d[ni]) + Math.abs(d[pi + 1] - d[ni + 1]) + Math.abs(d[pi + 2] - d[ni + 2]);
      if (dist <= TOL) { isBg[np] = 1; stack[sp++] = np; }
    };
    if (x > 0) tryN(p - 1);
    if (x < w - 1) tryN(p + 1);
    if (y > 0) tryN(p - w);
    if (y < h - 1) tryN(p + w);
  }

  // ── 2. Keep the largest foreground blob nearest the centre ──
  const label = new Int32Array(N);
  let bestLabel = 0, bestScore = -1, cur = 0;
  const cx = w / 2, cy = h / 2, diag = Math.hypot(w, h);
  for (let start = 0; start < N; start++) {
    if (isBg[start] || label[start]) continue;
    cur++;
    let area = 0, centreSum = 0;
    sp = 0; stack[sp++] = start; label[start] = cur;
    while (sp > 0) {
      const q = stack[--sp];
      area++;
      const qx = q % w, qy = (q / w) | 0;
      centreSum += 1 - Math.hypot(qx - cx, qy - cy) / diag; // ~1 at centre, ~0 at corners
      const tryF = (nq) => { if (!isBg[nq] && !label[nq]) { label[nq] = cur; stack[sp++] = nq; } };
      if (qx > 0) tryF(q - 1);
      if (qx < w - 1) tryF(q + 1);
      if (qy > 0) tryF(q - w);
      if (qy < h - 1) tryF(q + w);
    }
    const score = area * (centreSum / area); // area weighted by mean centredness
    if (score > bestScore) { bestScore = score; bestLabel = cur; }
  }

  // Everything except the winning blob becomes transparent
  let fg = 0, minX = w, minY = h, maxX = 0, maxY = 0;
  for (let p = 0; p < N; p++) {
    if (bestLabel && label[p] === bestLabel) {
      fg++;
      const x = p % w, y = (p / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else {
      d[p * 4 + 3] = 0;
    }
  }

  // ── Fallback when the mask is untrustworthy ──
  const frac = fg / N;
  if (fg === 0 || frac < 0.03 || frac > 0.97) return centerCrop(img);

  // ── 3. Feather the 1px rim to kill jagged edges ──
  const alpha = new Uint8ClampedArray(N);
  for (let p = 0; p < N; p++) alpha[p] = d[p * 4 + 3];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!alpha[p]) continue;
      const rim =
        (x > 0 && !alpha[p - 1]) || (x < w - 1 && !alpha[p + 1]) ||
        (y > 0 && !alpha[p - w]) || (y < h - 1 && !alpha[p + w]);
      if (rim) d[p * 4 + 3] = 130;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // ── Tight crop to the subject with a little padding ──
  const pad = Math.round(Math.max(w, h) * 0.04);
  const sx = Math.max(0, minX - pad);
  const sy = Math.max(0, minY - pad);
  const sw = Math.min(w - sx, maxX - minX + 1 + pad * 2);
  const sh = Math.min(h - sy, maxY - minY + 1 + pad * 2);
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  out.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL("image/png");
}

// Safe fallback: centred square crop (85%), no cut-out, capped at 640px.
function centerCrop(img) {
  const side = Math.min(img.width, img.height);
  const cropSide = Math.max(1, Math.round(side * 0.85));
  const sx = Math.round((img.width - cropSide) / 2);
  const sy = Math.round((img.height - cropSide) / 2);
  const outSide = Math.min(640, cropSide);
  const out = document.createElement("canvas");
  out.width = outSide;
  out.height = outSide;
  out.getContext("2d").drawImage(img, sx, sy, cropSide, cropSide, 0, 0, outSide, outSide);
  return out.toDataURL("image/png");
}

async function handlePhotoFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  photoStatus.textContent = state.lang === 'zh' ? "正在提取主体..." : "Extracting object...";
  try {
    const dataUrl = await extractObjectFromImage(file);
    state.extractedImage = dataUrl;
    extractedObject.innerHTML = `<img src="${dataUrl}" alt="Extracted item preview" />`;
    extractedObject.classList.add("has-image");
    
    const uploader = document.querySelector("#photoUploader");
    if (uploader) uploader.classList.add("is-extracted");
    
    photoStatus.textContent =
      state.photoSource === "camera"
        ? (state.lang === 'zh' ? "已成功提取相机照片轮廓" : "Camera photo extracted with a clean outline")
        : (state.lang === 'zh' ? "已成功提取相册照片轮廓" : "Album photo extracted with a clean outline");
  } catch {
    photoStatus.textContent = state.lang === 'zh' ? "无法提取此照片。请尝试其他图片。" : "Could not extract this photo. Try another image.";
  }
}

albumInput.addEventListener("change", handlePhotoFile);
cameraInput.addEventListener("change", handlePhotoFile);
itemStatus.addEventListener("change", syncStatusFields);

addItemForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = itemTitle.value.trim() || "Untitled item";
  const isWishlist = itemStatus.value === "Wishlist";
  const rating = isWishlist ? null : Math.max(1, Math.min(10, Number(itemRating.value) || 1));
  const rarity = itemRarity.value.trim();
  const priceVal = itemPrice.value.trim();
  const currencySymbol = document.getElementById("itemCurrency")?.value || "€";
  const price = priceVal ? `${currencySymbol}${priceVal}` : "";
  
  const targetCollectionId = document.getElementById("itemCollectionSelect").value;
  if (!targetCollectionId) {
    showToast(state.lang === 'zh' ? '请选择一个收藏夹' : 'Please select a collection');
    return;
  }
  
  const newItem = {
    id: `${slugify(title)}-${Date.now()}`,
    collectionId: targetCollectionId,
    title,
    note: itemNote.value.trim(),
    rating,
    tags: [...state.draftTags],
    added: formatDateLabel(itemDate.value),
    status: itemStatus.value,
    meta: { Rarity: rarity, Price: price },
    image: state.extractedImage,
    art:
      state.photoSource === "camera"
        ? "linear-gradient(135deg, #d9ff78, #2be7a7 48%, #0a58ff)"
        : "linear-gradient(135deg, #8fd3ff, #ffb199 48%, #ff5e8a)",
  };
  items.unshift(newItem);
  
  const targetColl = collections.find(c => c.id === targetCollectionId);
  if (targetColl) {
    targetColl.count += 1;
  }
  
  state.collectionId = targetCollectionId;
  state.selectedItemId = newItem.id;
  resetFilters();
  renderCollections();
  renderActiveCollection();
  setScreen("collection");
  renderItemDetail();
  closeSheets();
  showToast(`${title} added`);
  openDetailSheet();

  // Persist data
  persistData();
});

// Edit Collection & Manual Reorder event listeners
editCollectionBtn.addEventListener("click", () => {
  const collection = activeCollection();
  if (!collection) return;
  renameCollectionInput.value = collection.title;
  
  const len = collection.title.length;
  const counter = document.querySelector("#renameCharCounter");
  if (counter) {
    counter.textContent = `${len}/24`;
    counter.style.color = len >= 24 ? "#e21b3c" : "var(--muted)";
    counter.style.fontWeight = len >= 24 ? "600" : "normal";
  }
  saveCollectionNameBtn.disabled = true;

  // Card color — change it live after creation
  buildColorPicker("editCollectionColorPicker", collection.accent, (accent) => {
    collection.accent = accent;
    renderCollections();
    renderActiveCollection();
    persistData();
    showToast(state.lang === "zh" ? "颜色已更新" : "Color updated");
  });

  // Sharing & visibility — editable after creation
  document.querySelectorAll("#editCollectionVisibilitySegmented button").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.visibility === collection.visibility);
  });

  renderReorderList();

  editCollectionSheet.classList.add("is-open");
  editCollectionSheet.setAttribute("aria-hidden", "false");
  sheetBackdrop.hidden = false;
  if (window.floatingAddBtn) {
    floatingAddBtn.classList.add("is-hidden");
  }
});

closeEditCollectionButton.addEventListener("click", closeSheets);

if (window.addCollectionForm) {
  addCollectionForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = document.getElementById("addCollectionTitle").value.trim();
    const desc = document.getElementById("addCollectionDesc").value.trim();
    if (!title) return;
    
    const newId = "collection-" + Date.now();
    collections.push({
      id: newId,
      title: title,
      description: desc,
      count: 0,
      visibility: selectedCollectionVisibility,
      tags: [],
      accent: selectedCollectionAccent,
    });
    
    state.collectionId = newId;
    state.deckIndex = collections.length - 1;
    renderCollections();
    closeSheets();
    
    const msg = i18n[state.lang].toastCollectionCreated
      ? i18n[state.lang].toastCollectionCreated.replace("{name}", title)
      : `"${title}" created`;
    showToast(msg);

    // Persist data
    persistData();
  });
}

const collectionVisibilitySegmented = document.getElementById("collectionVisibilitySegmented");
if (collectionVisibilitySegmented) {
  collectionVisibilitySegmented.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    collectionVisibilitySegmented.querySelectorAll("button").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    selectedCollectionVisibility = btn.dataset.visibility;
  });
}

// Edit-sheet visibility — updates the active collection live
const editCollectionVisibilitySegmented = document.getElementById("editCollectionVisibilitySegmented");
if (editCollectionVisibilitySegmented) {
  editCollectionVisibilitySegmented.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const collection = activeCollection();
    if (!collection) return;
    editCollectionVisibilitySegmented.querySelectorAll("button").forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    collection.visibility = btn.dataset.visibility;
    renderActiveCollection();
    persistData();
  });
}

if (window.closeAddCollectionButton) {
  closeAddCollectionButton.addEventListener("click", closeSheets);
}

if (window.closeAddChoiceButton) {
  closeAddChoiceButton.addEventListener("click", closeSheets);
}

if (window.choiceAddCollectionBtn) {
  choiceAddCollectionBtn.addEventListener("click", () => {
    closeSheets();
    openAddCollectionSheet();
  });
}

if (window.choiceAddItemBtn) {
  choiceAddItemBtn.addEventListener("click", () => {
    closeSheets();
    openAddSheet();
  });
}

if (window.floatingAddBtn) {
  floatingAddBtn.addEventListener("click", () => {
    openAddSheet();
  });
}



renameCollectionInput.addEventListener("input", () => {
  const len = renameCollectionInput.value.length;
  const counter = document.querySelector("#renameCharCounter");
  if (counter) {
    counter.textContent = `${len}/24`;
    counter.style.color = len >= 24 ? "#e21b3c" : "var(--muted)";
    counter.style.fontWeight = len >= 24 ? "600" : "normal";
  }
  
  const collection = activeCollection();
  const currentTitle = collection ? collection.title : "";
  const newName = renameCollectionInput.value.trim();
  saveCollectionNameBtn.disabled = !newName || newName === currentTitle;
});

saveCollectionNameBtn.addEventListener("click", () => {
  const newName = renameCollectionInput.value.trim();
  if (!newName) {
    showToast("Title cannot be empty");
    return;
  }
  const collection = activeCollection();
  if (!collection) return;
  collection.title = newName;
  renderActiveCollection();
  renderCollections();
  showToast(`Collection renamed to "${newName}"`);
  saveCollectionNameBtn.disabled = true;

  // Persist data
  persistData();
});

const shareCollectionBtn = document.getElementById("shareCollectionBtn");
if (shareCollectionBtn) {
  shareCollectionBtn.addEventListener("click", async () => {
    const collection = activeCollection();
    if (!collection) return;

    const collectionItems = getCollectionItems(collection.id);
    
    // Construct the share text
    let shareText = "";
    if (state.lang === 'zh') {
      shareText = `📂 收藏夹: ${collection.title} (${collectionItems.length} 件单品)\n\n`;
      collectionItems.forEach((item, idx) => {
        const ratingStr = item.rating != null ? `, 评分: ${item.rating.toFixed(1)}/10` : "";
        const priceStr = item.meta?.Price ? `, 价格: ${item.meta.Price}` : "";
        const statusStr = item.status === "Owned" ? "已拥有" : "心愿单";
        const tagsStr = item.tags && item.tags.length > 0 ? `\n   标签: ${item.tags.join(", ")}` : "";

        shareText += `${idx + 1}. ${item.title} (${statusStr}${ratingStr}${priceStr})${tagsStr}\n`;
      });
    } else {
      shareText = `📂 Collection: ${collection.title} (${collectionItems.length} items)\n\n`;
      collectionItems.forEach((item, idx) => {
        const ratingStr = item.rating != null ? `, Rating: ${item.rating.toFixed(1)}/10` : "";
        const priceStr = item.meta?.Price ? `, Price: ${item.meta.Price}` : "";
        const statusStr = item.status;
        const tagsStr = item.tags && item.tags.length > 0 ? `\n   Tags: ${item.tags.join(", ")}` : "";

        shareText += `${idx + 1}. ${item.title} (${statusStr}${ratingStr}${priceStr})${tagsStr}\n`;
      });
    }

    // Try Web Share API first
    if (navigator.share) {
      try {
        await navigator.share({
          title: collection.title,
          text: shareText
        });
      } catch (err) {
        // If share was canceled by user, do nothing. If it failed for other reasons, fallback to copy.
        if (err.name !== "AbortError") {
          fallbackCopyToClipboard(shareText);
        }
      }
    } else {
      fallbackCopyToClipboard(shareText);
    }
  });
}

function fallbackCopyToClipboard(text) {
  const ok = () => showToast(i18n[state.lang].toastShareSuccess || "Collection list copied to clipboard!");
  const fail = () => showToast(i18n[state.lang].toastShareFail || "Failed to share or copy collection list");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(ok)
      .catch(() => { legacyCopy(text) ? ok() : fail(); });
  } else {
    legacyCopy(text) ? ok() : fail();
  }
}

// Works without the async Clipboard API (older browsers / non-secure contexts).
function legacyCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const done = document.execCommand("copy");
    document.body.removeChild(ta);
    return done;
  } catch {
    return false;
  }
}

const deleteCollectionBtn = document.getElementById("deleteCollectionBtn");
if (deleteCollectionBtn) {
  deleteCollectionBtn.addEventListener("click", () => {
    const collection = activeCollection();
    if (!collection) return;

    const confirmMsg = state.lang === 'zh'
      ? `确定要删除 "${collection.title}" 及其所有单品吗？此操作无法撤销。`
      : `Are you sure you want to delete "${collection.title}" and all its items? This action cannot be undone.`;

    if (confirm(confirmMsg)) {
      const colIndex = collections.findIndex(c => c.id === collection.id);
      if (colIndex !== -1) {
        collections.splice(colIndex, 1);
      }

      // Cascading delete items
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].collectionId === collection.id) {
          items.splice(i, 1);
        }
      }

      // Clear UI state
      closeSheets();
      
      // Navigate back to the collections (deck list) screen
      setScreen("collections");
      
      // Update collectionId to the first remaining collection, if any
      if (collections.length > 0) {
        state.collectionId = collections[0].id;
      } else {
        state.collectionId = "";
      }

      renderCollections();

      const successMsg = state.lang === 'zh'
        ? `已成功删除收藏夹 "${collection.title}"`
        : `Collection "${collection.title}" deleted successfully`;
      showToast(successMsg);

      // Persist data
      persistData();
    }
  });
}

function renderReorderList() {
  const reorderList = document.querySelector("#reorderList");
  if (items.length === 0) {
    reorderList.innerHTML = `<p class="micro-label" style="text-transform: none; padding: 12px; text-align: center;">No items to reorder</p>`;
    return;
  }
  reorderList.innerHTML = items
    .map((item, index) => {
      const artStyle = item.image ? "" : `style="--art: ${item.art}"`;
      return `
        <div class="reorder-item" data-index="${index}" draggable="true">
          <div class="drag-handle">☰</div>
          ${item.image ? `<img src="${item.image}" alt="" />` : `<div class="item-art-thumb" ${artStyle}></div>`}
          <span>${item.title}</span>
          <div class="reorder-buttons">
            <button class="reorder-btn move-up-btn" type="button" ${index === 0 ? "disabled" : ""} title="Move Up">▲</button>
            <button class="reorder-btn move-down-btn" type="button" ${index === items.length - 1 ? "disabled" : ""} title="Move Down">▼</button>
          </div>
        </div>
      `;
    })
    .join("");

  // Setup drag and drop events
  let dragSrcIndex = null;
  reorderList.querySelectorAll(".reorder-item").forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      dragSrcIndex = parseInt(item.dataset.index, 10);
      item.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    
    item.addEventListener("dragend", () => {
      item.classList.remove("is-dragging");
      reorderList.querySelectorAll(".reorder-item").forEach(el => el.classList.remove("drag-over"));
    });
    
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      item.classList.add("drag-over");
    });
    
    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-over");
    });
    
    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetIndex = parseInt(item.dataset.index, 10);
      if (dragSrcIndex !== null && dragSrcIndex !== targetIndex) {
        const draggedItem = items[dragSrcIndex];
        items.splice(dragSrcIndex, 1);
        items.splice(targetIndex, 0, draggedItem);
        
        state.sort = "custom";
        sortSelect.value = "custom";
        
        renderReorderList();
        renderItems();
        showToast("Order updated");

        // Persist data
        persistData();
      }
    });
  });
}

document.querySelector("#reorderList").addEventListener("click", (event) => {
  const btn = event.target.closest(".reorder-btn");
  if (!btn) return;
  const itemRow = btn.closest(".reorder-item");
  const index = parseInt(itemRow.dataset.index, 10);
  
  if (btn.classList.contains("move-up-btn")) {
    if (index > 0) {
      const temp = items[index];
      items[index] = items[index - 1];
      items[index - 1] = temp;
      
      state.sort = "custom";
      sortSelect.value = "custom";
      
      renderReorderList();
      renderItems();
      showToast("Order updated");

      // Persist data
      persistData();
    }
  } else if (btn.classList.contains("move-down-btn")) {
    if (index < items.length - 1) {
      const temp = items[index];
      items[index] = items[index + 1];
      items[index + 1] = temp;
      
      state.sort = "custom";
      sortSelect.value = "custom";
      
      renderReorderList();
      renderItems();
      showToast("Order updated");

      // Persist data
      persistData();
    }
  }
});

// Batch Actions event listeners
batchDeleteModeBtn.addEventListener("click", () => {
  closeSheets();
  state.batchMode = true;
  state.selectedItems.clear();
  batchBar.classList.remove("is-hidden");
  batchCountText.textContent = state.lang === 'zh' ? "已选择 0 件单品" : "0 items selected";
  renderItems();
});

batchCancelBtn.addEventListener("click", () => {
  state.batchMode = false;
  state.selectedItems.clear();
  batchBar.classList.add("is-hidden");
  renderItems();
});

batchDeleteBtn.addEventListener("click", () => {
  if (state.selectedItems.size === 0) {
    showToast("No items selected");
    return;
  }
  const beforeCount = items.length;
  const toDelete = Array.from(state.selectedItems);
  toDelete.forEach(id => {
    const idx = items.findIndex(item => item.id === id);
    if (idx !== -1) {
      items.splice(idx, 1);
    }
  });
  
  const deletedCount = beforeCount - items.length;
  showToast(state.lang === 'zh' ? `已删除 ${deletedCount} 件单品` : `Deleted ${deletedCount} item(s)`);
  
  const collection = activeCollection();
  if (collection) {
    collection.count = items.filter(item => item.collectionId === collection.id).length;
    if (state.screen === "collection") {
      screenKicker.textContent = "";
      screenKicker.style.display = "none";
    } else {
      screenKicker.textContent = `${collection.count} ${i18n[state.lang].itemsCount} • ${translateVisibility(collection.visibility)}`;
      screenKicker.style.display = "";
    }
  }
  
  state.batchMode = false;
  state.selectedItems.clear();
  batchBar.classList.add("is-hidden");
  
  renderItems();
  renderCollections();

  // Persist data
  persistData();
});

// ═══════════════════════════════════════════════════════════
// App Initialization & Auth Flow
// ═══════════════════════════════════════════════════════════

// Initialize language from localStorage
try {
  const savedLang = localStorage.getItem("app_lang");
  if (savedLang) {
    state.lang = savedLang;
  }
} catch (e) {}

// ── Auth state: sign-in vs sign-up mode ────────────────
let authIsSignUp = false;

function updateAuthUI() {
  const lang = state.lang;
  const titleEl = document.getElementById("authTitle");
  const subEl = document.getElementById("authSubtitle");
  const emailLabel = document.getElementById("authEmailLabelText");
  const passLabel = document.getElementById("authPasswordLabelText");
  const submitText = document.getElementById("authSubmitText");
  const switchText = document.getElementById("authSwitchText");
  const switchBtn = document.getElementById("authSwitchBtn");
  const emailInput = document.getElementById("authEmail");
  const passInput = document.getElementById("authPassword");

  if (titleEl) titleEl.textContent = i18n[lang].authWelcomeTitle;
  if (subEl) subEl.textContent = i18n[lang].authWelcomeSub;
  if (emailLabel) emailLabel.textContent = i18n[lang].authEmailLabel;
  if (passLabel) passLabel.textContent = i18n[lang].authPasswordLabel;
  if (emailInput) emailInput.placeholder = i18n[lang].authEmailPlaceholder;
  if (passInput) passInput.placeholder = i18n[lang].authPasswordPlaceholder;

  if (authIsSignUp) {
    if (submitText) submitText.textContent = i18n[lang].authSignUp;
    if (switchText) switchText.textContent = i18n[lang].authSwitchToSignIn;
    if (switchBtn) switchBtn.textContent = i18n[lang].authSwitchSignInBtn;
  } else {
    if (submitText) submitText.textContent = i18n[lang].authSignIn;
    if (switchText) switchText.textContent = i18n[lang].authSwitchToSignUp;
    if (switchBtn) switchBtn.textContent = i18n[lang].authSwitchSignUpBtn;
  }
}

function showAuthError(message) {
  const errorEl = document.getElementById("authError");
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove("is-hidden");
  }
}

function hideAuthError() {
  const errorEl = document.getElementById("authError");
  if (errorEl) {
    errorEl.classList.add("is-hidden");
  }
}

function setAuthLoading(loading) {
  const btn = document.getElementById("authSubmitBtn");
  const spinner = document.getElementById("authSpinner");
  if (btn) {
    btn.disabled = loading;
    btn.classList.toggle("is-loading", loading);
  }
  if (spinner) {
    spinner.classList.toggle("is-hidden", !loading);
  }
}

// ── Auth form handlers ─────────────────────────────────
const authForm = document.getElementById("authForm");
const authSwitchBtn = document.getElementById("authSwitchBtn");

if (authForm) {
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthError();
    setAuthLoading(true);

    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;

    try {
      if (authIsSignUp) {
        await dbService.signUp(email, password);
        showToast(i18n[state.lang].authToastSignedUp);
      } else {
        await dbService.signIn(email, password);
        showToast(i18n[state.lang].authToastSignedIn);
      }
      // onAuthStateChanged will handle the rest
    } catch (err) {
      const msg = dbService.getAuthErrorMessage(err.code);
      showAuthError(msg);
      setAuthLoading(false);
    }
  });
}

if (authSwitchBtn) {
  authSwitchBtn.addEventListener("click", () => {
    authIsSignUp = !authIsSignUp;
    hideAuthError();
    updateAuthUI();
  });
}

// ── Data loader ────────────────────────────────────────
async function loadUserData(userId) {
  // Load collections
  const savedCols = await dbService.getCollections(userId);
  if (savedCols && savedCols.length > 0) {
    collections.length = 0;
    savedCols.forEach(c => collections.push(c));
  }

  // Load items
  const savedItems = await dbService.getItems(userId);
  if (savedItems && savedItems.length > 0) {
    items.length = 0;
    savedItems.forEach(i => items.push(i));
  }
}

// ── Local profile store (name / bio / avatar) ──────────
const PROFILE_KEY = "app_profile";

function getProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveProfile(profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
}

function renderProfile() {
  const profile = getProfile();
  const nameEl = document.getElementById("settingsProfileName");
  const subEl = document.getElementById("settingsProfileSub");
  const avatarEl = document.getElementById("settingsAvatar");

  const name = profile.name || i18n[state.lang].profileDefaultName;
  const bio = profile.bio || i18n[state.lang].profileDefaultBio;

  if (nameEl) nameEl.textContent = name;
  if (subEl) subEl.textContent = bio;
  applyAvatar(avatarEl, profile.avatar);
}

function applyAvatar(el, dataUrl) {
  if (!el) return;
  if (dataUrl) {
    el.style.backgroundImage = `url("${dataUrl}")`;
    el.classList.add("has-image");
  } else {
    el.style.backgroundImage = "";
    el.classList.remove("has-image");
  }
}

function updateSettingsProfile(user) {
  // Cloud Mode uses the signed-in email; Local Mode uses the stored profile.
  if (dbService.isFirebaseActive && user) {
    const nameEl = document.getElementById("settingsProfileName");
    const subEl = document.getElementById("settingsProfileSub");
    if (nameEl) nameEl.textContent = user.email.split("@")[0];
    if (subEl) subEl.textContent = i18n[state.lang].settingsProfileCloud;
    applyAvatar(document.getElementById("settingsAvatar"), getProfile().avatar);
  } else {
    renderProfile();
  }
}

// ── Persist helper — call after any data mutation ──────
function persistData() {
  dbService.persistAll().catch(err => {
    console.warn("[dbService] Persist error:", err);
  });
}

// ── Main startup ───────────────────────────────────────
async function startApp() {
  if (dbService.isFirebaseActive) {
    // ─── Cloud Mode ───────────────────────────────────
    // Hide everything until auth resolves
    setScreen("auth");
    updateAuthUI();

    // Hide topbar elements on auth screen
    if (backButton) backButton.classList.add("is-hidden");
    if (settingsButton) settingsButton.classList.add("is-hidden");
    if (window.floatingAddBtn) floatingAddBtn.classList.add("is-hidden");

    dbService.auth.onAuthStateChanged(async (user) => {
      if (user) {
        dbService.currentUser = user;
        setAuthLoading(false);

        // Load user data from Firestore
        await loadUserData(user.uid);

        // If first time (no data), seed with default data and persist
        if (collections.length === 0) {
          // Keep the default collections/items from data.js as seeds
          // They're already populated in the global arrays
          // But we should reload them from the original source
        }

        updateSettingsProfile(user);
        updateLanguage();
        renderTags();
        renderItemDetail();
        itemDate.value = getISODate();
        syncStatusFields();
        setScreen("collections");

        // Show topbar elements
        if (settingsButton) settingsButton.classList.remove("is-hidden");
        if (window.floatingAddBtn) floatingAddBtn.classList.remove("is-hidden");
      } else {
        dbService.currentUser = null;
        // Show auth screen
        setScreen("auth");
        updateAuthUI();

        if (backButton) backButton.classList.add("is-hidden");
        if (settingsButton) settingsButton.classList.add("is-hidden");
        if (window.floatingAddBtn) floatingAddBtn.classList.add("is-hidden");
      }
    });
  } else {
    // ─── Local Mode ───────────────────────────────────
    // Load persisted data from LocalStorage (if any)
    await loadUserData(null);

    // If this is a fresh install (no LocalStorage data), seed and persist
    if (!localStorage.getItem("app_collections")) {
      persistData();
    }

    updateSettingsProfile(null);
    updateLanguage();
    renderTags();
    renderItemDetail();
    itemDate.value = getISODate();
    syncStatusFields();
    setScreen("collections");
  }
}

startApp();
