import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  deleteObject,
  getBlob,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import * as firebaseConfigModule from "./firebase-config.js";

const firebaseConfig = firebaseConfigModule.firebaseConfig || window.firebaseConfig || {};

const STORAGE_KEY = "storechecks.v1";
const COLLECTION_NAME = "storechecks";

// Fotokwaliteit. FULL_MAX is de versie die je in de ZIP-export krijgt.
// Zet FULL_MAX op 0 als je originelen in volle resolutie wilt bewaren.
const THUMB_MAX = 400;
const FULL_MAX = 1600;
const JPEG_QUALITY = 0.82;
const CACHE_CONTROL = "public, max-age=31536000";

const appLayout = document.querySelector("#appLayout");
const loginPortal = document.querySelector("#loginPortal");
const loginButton = document.querySelector("#loginButton");
const loginButtonHeader = document.querySelector("#loginButtonHeader");
const logoutButton = document.querySelector("#logoutButton");
const userBadge = document.querySelector("#userBadge");
const navButtons = document.querySelectorAll(".top-nav button");
const form = document.querySelector("#checkForm");
const photoInput = document.querySelector("#photos");
const preview = document.querySelector("#preview");
const dashboardView = document.querySelector("#dashboardView");
const storesView = document.querySelector("#storesView");
const checksEl = document.querySelector("#checks");
const storesList = document.querySelector("#storesList");
const storeChecks = document.querySelector("#storeChecks");
const template = document.querySelector("#checkTemplate");
const summary = document.querySelector("#summary");
const storesSummary = document.querySelector("#storesSummary");
const optimizeButton = document.querySelector("#optimizeButton");
const exportButton = document.querySelector("#exportButton");
const exportDialog = document.querySelector("#exportDialog");
const exportClose = document.querySelector("#exportClose");
const filterCountries = document.querySelector("#filterCountries");
const filterStores = document.querySelector("#filterStores");
const filterYears = document.querySelector("#filterYears");
const storeSearch = document.querySelector("#storeSearch");
const exportSummary = document.querySelector("#exportSummary");
const downloadZipButton = document.querySelector("#downloadZipButton");
const visitDate = document.querySelector("#visitDate");
const syncStatus = document.querySelector("#syncStatus");
const totalChecks = document.querySelector("#totalChecks");
const latestVisit = document.querySelector("#latestVisit");
const photoViewer = document.querySelector("#photoViewer");
const photoViewerImage = document.querySelector("#photoViewerImage");
const photoViewerCaption = document.querySelector("#photoViewerCaption");
const photoViewerClose = document.querySelector("#photoViewerClose");
const photoViewerPrev = document.querySelector("#photoViewerPrev");
const photoViewerNext = document.querySelector("#photoViewerNext");
const checkEditor = document.querySelector("#checkEditor");
const checkEditorClose = document.querySelector("#checkEditorClose");
const checkEditorTitle = document.querySelector("#checkEditorTitle");
const checkEditorMeta = document.querySelector("#checkEditorMeta");
const checkEditorPhotos = document.querySelector("#checkEditorPhotos");
const checkEditorFiles = document.querySelector("#checkEditorFiles");
const checkEditorUpload = document.querySelector("#checkEditorUpload");

let checks = [];
let firebase = null;
let currentUser = null;
let unsubscribeChecks = null;
let currentView = "dashboard";
let selectedStoreKey = "";
let editingCheckId = "";
let viewerPhotos = [];
let viewerPhotoIndex = 0;

const GALLERY_LIMIT = 6;
const exportFilters = {
  countries: new Set(),
  stores: new Set(),
  years: new Set(),
};

const today = new Date().toISOString().slice(0, 10);
visitDate.value = today;

loginButton.addEventListener("click", login);
loginButtonHeader.addEventListener("click", login);
logoutButton.addEventListener("click", logout);
navButtons.forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
photoInput.addEventListener("change", renderPreview);
form.addEventListener("submit", saveCheck);
optimizeButton.addEventListener("click", optimizeExistingPhotos);
exportButton.addEventListener("click", openExportDialog);
exportClose.addEventListener("click", closeExportDialog);
exportDialog.addEventListener("click", (event) => {
  if (event.target === exportDialog) closeExportDialog();
});
storeSearch.addEventListener("input", renderStoreFilter);
document.querySelectorAll("[data-clear]").forEach((button) => {
  button.addEventListener("click", () => {
    exportFilters[button.dataset.clear].clear();
    renderExportFilters();
  });
});
downloadZipButton.addEventListener("click", exportChecksZip);
photoViewerClose.addEventListener("click", closePhotoViewer);
photoViewerPrev.addEventListener("click", () => showAdjacentPhoto(-1));
photoViewerNext.addEventListener("click", () => showAdjacentPhoto(1));
photoViewer.addEventListener("click", (event) => {
  if (event.target === photoViewer) closePhotoViewer();
});
checkEditorClose.addEventListener("click", closeCheckEditor);
checkEditor.addEventListener("click", (event) => {
  if (event.target === checkEditor) closeCheckEditor();
});
checkEditorUpload.addEventListener("click", addPhotosToEditingCheck);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePhotoViewer();
    closeCheckEditor();
    closeExportDialog();
  }
  if (!photoViewer.hidden && event.key === "ArrowLeft") showAdjacentPhoto(-1);
  if (!photoViewer.hidden && event.key === "ArrowRight") showAdjacentPhoto(1);
});

startApp();

function startApp() {
  try {
    firebase = createFirebaseClient();
  } catch (error) {
    console.error(error);
    setStatus("Firebase-configuratie klopt niet. Controleer firebase-config.js.");
    showLogin();
    return;
  }

  if (!firebase) {
    setStatus("Firebase-configuratie ontbreekt. Controleer firebase-config.js.");
    showLogin();
    return;
  }

  setStatus("Log in om Firebase te gebruiken");
  onAuthStateChanged(firebase.auth, (user) => {
    currentUser = user;
    if (user) {
      showApp(user);
      subscribeToChecks(user);
      return;
    }

    checks = [];
    if (unsubscribeChecks) unsubscribeChecks();
    unsubscribeChecks = null;
    showLogin();
    renderChecks();
  });
}

function createFirebaseClient() {
  const requiredKeys = ["apiKey", "authDomain", "projectId", "storageBucket", "appId"];
  const isConfigured = requiredKeys.every((key) => Boolean(firebaseConfig[key]));
  if (!isConfigured) return null;

  const initializedApp = initializeApp(firebaseConfig);
  return {
    auth: getAuth(initializedApp),
    db: getFirestore(initializedApp),
    provider: new GoogleAuthProvider(),
    storage: getStorage(initializedApp),
  };
}

async function login() {
  if (!firebase) return;
  try {
    await signInWithPopup(firebase.auth, firebase.provider);
  } catch (error) {
    console.error(error);
    alert("Inloggen is niet gelukt. Controleer of Google Authentication aanstaat in Firebase.");
  }
}

async function logout() {
  if (!firebase) return;
  await signOut(firebase.auth);
}

function showLogin() {
  loginPortal.hidden = false;
  appLayout.hidden = true;
  loginButtonHeader.hidden = false;
  logoutButton.hidden = true;
  userBadge.hidden = true;
  exportButton.hidden = true;
  closeExportDialog();
  setStatus("Niet ingelogd");
}

function showApp(user) {
  loginPortal.hidden = true;
  appLayout.hidden = false;
  loginButtonHeader.hidden = true;
  logoutButton.hidden = !firebase;
  userBadge.hidden = !user;
  exportButton.hidden = false;

  if (user) {
    userBadge.textContent = user.email || user.displayName || "Ingelogd";
    setStatus("Verbonden met Firebase");
  }
}

function subscribeToChecks(user) {
  if (unsubscribeChecks) unsubscribeChecks();

  const checksQuery = query(collection(firebase.db, COLLECTION_NAME), where("ownerUid", "==", user.uid));
  unsubscribeChecks = onSnapshot(
    checksQuery,
    (snapshot) => {
      checks = snapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      renderChecks();
    },
    (error) => {
      console.error(error);
      setStatus("Firebase fout: controleer regels en configuratie");
    },
  );
}

function setStatus(text) {
  syncStatus.textContent = text;
}

function loadLocalChecks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persistLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(checks));
}

function renderPreview() {
  preview.innerHTML = "";
  [...photoInput.files].forEach((file) => {
    const img = document.createElement("img");
    img.alt = file.name;
    img.src = URL.createObjectURL(file);
    preview.append(img);
  });
}

async function saveCheck(event) {
  event.preventDefault();
  if (firebase && !currentUser) {
    alert("Log eerst in voordat je een check opslaat.");
    return;
  }

  const saveButton = form.querySelector(".primary-button");
  const originalText = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = firebase ? "Uploaden..." : "Opslaan...";

  try {
    const data = new FormData(form);
    const files = [...photoInput.files];
    const checkId = crypto.randomUUID();
    const baseCheck = {
      chain: data.get("chain").trim(),
      country: data.get("country"),
      location: data.get("location").trim(),
      visitDate: data.get("visitDate"),
      notes: data.get("notes").trim(),
      createdAt: new Date().toISOString(),
    };

    if (firebase) {
      const photos = await Promise.all(files.map((file) => uploadPhoto(file, checkId)));
      await addDoc(collection(firebase.db, COLLECTION_NAME), {
        ...baseCheck,
        ownerUid: currentUser.uid,
        ownerEmail: currentUser.email || "",
        photos,
      });
    } else {
      const photos = await Promise.all(files.map(fileToLocalPhoto));
      checks.unshift({ id: checkId, ...baseCheck, photos });
      persistLocal();
      renderChecks();
    }

    form.reset();
    visitDate.value = today;
    preview.innerHTML = "";
  } catch (error) {
    console.error(error);
    alert("Opslaan is niet gelukt. Controleer je Firebase-configuratie en regels.");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalText;
  }
}

function photoThumb(photo) {
  return photo.thumbUrl || photo.url || photo.data || "";
}

function photoFull(photo) {
  return photo.url || photo.data || "";
}

function outputMime(type) {
  return type === "image/png" ? "image/png" : "image/jpeg";
}

async function loadBitmap(source) {
  return createImageBitmap(source, { imageOrientation: "from-image" });
}

function resizeToBlob(bitmap, maxSize, mimeType) {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = maxSize > 0 ? Math.min(1, maxSize / longest) : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Foto verkleinen is mislukt."))),
      mimeType,
      JPEG_QUALITY,
    );
  });
}

async function uploadPhoto(file, checkId) {
  const safeName = file.name.replace(/[^\w.-]/g, "_");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const basePath = `${COLLECTION_NAME}/${currentUser.uid}/${checkId}/${stamp}`;

  let bitmap = null;
  try {
    bitmap = await loadBitmap(file);
  } catch (error) {
    console.warn("Verkleinen niet mogelijk, origineel wordt geupload:", error);
  }

  if (!bitmap) {
    const storageRef = ref(firebase.storage, `${basePath}-${safeName}`);
    await uploadBytes(storageRef, file, { contentType: file.type, cacheControl: CACHE_CONTROL });
    return { name: file.name, type: file.type, path: storageRef.fullPath, url: await getDownloadURL(storageRef), size: file.size };
  }

  const mime = outputMime(file.type);
  const fullBlob = await resizeToBlob(bitmap, FULL_MAX, mime);
  const thumbBlob = await resizeToBlob(bitmap, THUMB_MAX, mime);
  bitmap.close();

  const fullRef = ref(firebase.storage, `${basePath}-${safeName}`);
  const thumbRef = ref(firebase.storage, `${basePath}-thumb-${safeName}`);

  await Promise.all([
    uploadBytes(fullRef, fullBlob, { contentType: mime, cacheControl: CACHE_CONTROL }),
    uploadBytes(thumbRef, thumbBlob, { contentType: mime, cacheControl: CACHE_CONTROL }),
  ]);

  const [url, thumbUrl] = await Promise.all([getDownloadURL(fullRef), getDownloadURL(thumbRef)]);

  return {
    name: file.name,
    type: mime,
    path: fullRef.fullPath,
    url,
    thumbPath: thumbRef.fullPath,
    thumbUrl,
    size: fullBlob.size,
  };
}

function fileToLocalPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openExportDialog() {
  pruneExportFilters();
  renderExportFilters();
  exportDialog.hidden = false;
  document.body.classList.add("viewer-open");
  exportClose.focus();
}

function closeExportDialog() {
  if (exportDialog.hidden) return;
  exportDialog.hidden = true;
  if (photoViewer.hidden && checkEditor.hidden) document.body.classList.remove("viewer-open");
}

function pruneExportFilters() {
  const countries = new Set(getCountries());
  const stores = new Set(getStores().map((store) => store.key));
  const years = new Set(getYears());

  [...exportFilters.countries].forEach((value) => {
    if (!countries.has(value)) exportFilters.countries.delete(value);
  });
  [...exportFilters.stores].forEach((value) => {
    if (!stores.has(value)) exportFilters.stores.delete(value);
  });
  [...exportFilters.years].forEach((value) => {
    if (!years.has(value)) exportFilters.years.delete(value);
  });
}

function renderExportFilters() {
  renderCountryFilter();
  renderStoreFilter();
  renderYearFilter();
  updateExportSummary();
}

function renderCountryFilter() {
  const counts = new Map();
  checks.forEach((check) => {
    const country = check.country || "Onbekend land";
    counts.set(country, (counts.get(country) || 0) + 1);
  });

  renderFilterOptions(filterCountries, getCountries().map((country) => ({
    value: country,
    label: country,
    count: counts.get(country) || 0,
  })), "countries", "Nog geen landen.");
}

function renderStoreFilter() {
  const term = storeSearch.value.trim().toLowerCase();
  const stores = getStores().filter((store) => {
    const matchesCountry = !exportFilters.countries.size || exportFilters.countries.has(store.country);
    const matchesTerm = !term
      || store.chain.toLowerCase().includes(term)
      || store.location.toLowerCase().includes(term);
    return matchesCountry && matchesTerm;
  });

  renderFilterOptions(filterStores, stores.map((store) => ({
    value: store.key,
    label: `${store.chain} - ${store.location}`,
    count: store.checks.length,
  })), "stores", term ? "Geen winkels gevonden." : "Nog geen winkels.");
}

function renderYearFilter() {
  const counts = new Map();
  checks.forEach((check) => {
    const year = getYear(getCheckDate(check));
    if (year) counts.set(year, (counts.get(year) || 0) + 1);
  });

  renderFilterOptions(filterYears, getYears().map((year) => ({
    value: year,
    label: year,
    count: counts.get(year) || 0,
  })), "years", "Nog geen jaren.");
}

function renderFilterOptions(container, options, group, emptyText) {
  container.innerHTML = "";

  if (!options.length) {
    const empty = document.createElement("p");
    empty.className = "empty filter-empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  options.forEach((option) => {
    const label = document.createElement("label");
    label.className = "filter-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = option.value;
    input.checked = exportFilters[group].has(option.value);
    input.addEventListener("change", () => {
      if (input.checked) exportFilters[group].add(option.value);
      else exportFilters[group].delete(option.value);
      if (group === "countries") {
        pruneStoreSelection();
        renderStoreFilter();
      }
      updateExportSummary();
      container.querySelectorAll(".filter-option").forEach((item) => {
        item.classList.toggle("checked", item.querySelector("input").checked);
      });
    });

    const text = document.createElement("span");
    text.textContent = option.label;

    const count = document.createElement("em");
    count.textContent = option.count;

    label.classList.toggle("checked", input.checked);
    label.append(input, text, count);
    container.append(label);
  });
}

function pruneStoreSelection() {
  if (!exportFilters.countries.size) return;
  const allowed = new Set(
    getStores()
      .filter((store) => exportFilters.countries.has(store.country))
      .map((store) => store.key),
  );
  [...exportFilters.stores].forEach((key) => {
    if (!allowed.has(key)) exportFilters.stores.delete(key);
  });
}

function updateExportSummary() {
  const selected = getSelectedExportChecks();
  const photoCount = selected.reduce((total, check) => total + (check.photos || []).length, 0);
  const parts = [];
  if (exportFilters.countries.size) parts.push(`${exportFilters.countries.size} land(en)`);
  if (exportFilters.stores.size) parts.push(`${exportFilters.stores.size} winkel(s)`);
  if (exportFilters.years.size) parts.push(`${exportFilters.years.size} jaar`);

  const filterText = parts.length ? `Filter: ${parts.join(", ")}. ` : "Geen filter, alles wordt meegenomen. ";
  exportSummary.textContent = `${filterText}${selected.length} check(s), ${photoCount} foto('s).`;
  downloadZipButton.disabled = !selected.length;
}

function renderChecks() {
  renderStats();
  renderOptimizeButton();
  renderDashboardChecks();
  renderStores();
  if (editingCheckId && !checkEditor.hidden) renderCheckEditor();
  if (!exportDialog.hidden) {
    pruneExportFilters();
    renderExportFilters();
  }
}

function setView(view) {
  currentView = view || "dashboard";
  dashboardView.hidden = currentView !== "dashboard";
  storesView.hidden = currentView !== "stores";
  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  renderChecks();
}

function renderDashboardChecks() {
  const recentChecks = checks.slice(0, 6);
  checksEl.innerHTML = "";
  summary.textContent = checks.length
    ? `${recentChecks.length} meest recente van ${checks.length} opgeslagen checks`
    : "Nog geen checks opgeslagen.";

  renderCheckCards(checksEl, recentChecks, "Voeg je eerste winkelbezoek toe.");
}

function renderCheckCards(container, list, emptyText) {
  container.innerHTML = "";

  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }

  list.forEach((check) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.tabIndex = 0;
    card.addEventListener("click", () => openCheckEditor(check.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openCheckEditor(check.id);
    });
    card.querySelector(".country").textContent = check.country;
    card.querySelector("h3").textContent = check.chain;
    card.querySelector(".location").textContent = check.location;
    card.querySelector(".visit-date").textContent = formatDate(getCheckDate(check));
    card.querySelector(".photo-count").textContent = `${(check.photos || []).length}`;
    card.querySelector(".notes").textContent = check.notes || "Geen notities.";
    card.querySelector(".delete-button").addEventListener("click", (event) => {
      event.stopPropagation();
      deleteCheck(check.id);
    });

    const gallery = card.querySelector(".gallery");
    const photos = check.photos || [];
    const hasOverflow = photos.length > GALLERY_LIMIT;
    const visibleCount = hasOverflow ? GALLERY_LIMIT - 1 : photos.length;
    const visiblePhotos = photos.slice(0, visibleCount);

    visiblePhotos.forEach((photo, index) => {
      const img = document.createElement("img");
      img.src = photoThumb(photo);
      img.alt = `${check.chain} - ${photo.name}`;
      img.loading = "lazy";
      img.tabIndex = 0;
      img.addEventListener("click", (event) => {
        event.stopPropagation();
        openPhotoViewer(photos, index, check.chain);
      });
      img.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          openPhotoViewer(photos, index, check.chain);
        }
      });
      gallery.append(img);
    });

    if (hasOverflow) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "gallery-more";
      more.textContent = `+${photos.length - visibleCount}`;
      more.setAttribute("aria-label", `Alle ${photos.length} foto's bekijken`);
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        openPhotoViewer(photos, visibleCount, check.chain);
      });
      gallery.append(more);
    }

    container.append(card);
  });
}

function openCheckEditor(checkId) {
  editingCheckId = checkId;
  renderCheckEditor();
  checkEditor.hidden = false;
  document.body.classList.add("viewer-open");
  checkEditorClose.focus();
}

function closeCheckEditor() {
  if (checkEditor.hidden) return;
  checkEditor.hidden = true;
  editingCheckId = "";
  checkEditorFiles.value = "";
  if (photoViewer.hidden) document.body.classList.remove("viewer-open");
}

function renderCheckEditor() {
  const check = checks.find((item) => item.id === editingCheckId);
  if (!check) {
    closeCheckEditor();
    return;
  }

  checkEditorTitle.textContent = check.chain || "Storecheck";
  checkEditorMeta.textContent = `${check.location || "Onbekend filiaal"} - ${formatDate(getCheckDate(check))}`;
  checkEditorPhotos.innerHTML = "";

  if (!(check.photos || []).length) {
    const empty = document.createElement("p");
    empty.className = "empty editor-empty";
    empty.textContent = "Nog geen foto's bij deze check.";
    checkEditorPhotos.append(empty);
    return;
  }

  (check.photos || []).forEach((photo, index) => {
    const item = document.createElement("article");
    item.className = "editor-photo";

    const img = document.createElement("img");
    img.src = photoThumb(photo);
    img.loading = "lazy";
    img.alt = `${check.chain} - ${photo.name}`;
    img.addEventListener("click", () => openPhotoViewer(check.photos || [], index, check.chain));

    const label = document.createElement("span");
    label.textContent = photo.name || `Foto ${index + 1}`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Verwijderen";
    button.addEventListener("click", () => removePhotoFromEditingCheck(index));

    item.append(img, label, button);
    checkEditorPhotos.append(item);
  });
}

async function addPhotosToEditingCheck() {
  const check = checks.find((item) => item.id === editingCheckId);
  const files = [...checkEditorFiles.files];
  if (!check || !files.length) return;

  const originalText = checkEditorUpload.textContent;
  checkEditorUpload.disabled = true;
  checkEditorUpload.textContent = "Toevoegen...";

  try {
    const newPhotos = firebase
      ? await Promise.all(files.map((file) => uploadPhoto(file, check.id)))
      : await Promise.all(files.map(fileToLocalPhoto));
    const updatedPhotos = [...(check.photos || []), ...newPhotos];
    await saveCheckPhotos(check.id, updatedPhotos);
    checkEditorFiles.value = "";
  } catch (error) {
    console.error(error);
    alert("Foto's toevoegen is niet gelukt.");
  } finally {
    checkEditorUpload.disabled = false;
    checkEditorUpload.textContent = originalText;
  }
}

async function removePhotoFromEditingCheck(photoIndex) {
  const check = checks.find((item) => item.id === editingCheckId);
  if (!check) return;

  const photo = (check.photos || [])[photoIndex];
  if (!photo || !confirm("Deze foto verwijderen?")) return;

  try {
    if (firebase) {
      await Promise.all(
        [photo.path, photo.thumbPath]
          .filter(Boolean)
          .map((path) => deleteObject(ref(firebase.storage, path)).catch(() => null)),
      );
    }
    const updatedPhotos = (check.photos || []).filter((_, index) => index !== photoIndex);
    await saveCheckPhotos(check.id, updatedPhotos);
  } catch (error) {
    console.error(error);
    alert("Foto verwijderen is niet gelukt.");
  }
}

async function saveCheckPhotos(checkId, photos) {
  if (firebase) {
    await updateDoc(doc(firebase.db, COLLECTION_NAME, checkId), { photos });
    checks = checks.map((check) => (check.id === checkId ? { ...check, photos } : check));
    renderChecks();
    renderCheckEditor();
    return;
  }

  checks = checks.map((check) => (check.id === checkId ? { ...check, photos } : check));
  persistLocal();
  renderChecks();
  renderCheckEditor();
}

function openPhotoViewer(photos, startIndex = 0, checkName = "") {
  viewerPhotos = (photos || []).map((photo, index) => ({
    src: photoFull(photo),
    caption: `${checkName} - ${photo.name || `Foto ${index + 1}`}`,
  })).filter((photo) => photo.src);
  viewerPhotoIndex = Math.min(Math.max(startIndex, 0), Math.max(viewerPhotos.length - 1, 0));
  renderViewerPhoto();
  photoViewer.hidden = false;
  document.body.classList.add("viewer-open");
  photoViewerClose.focus();
}

function renderViewerPhoto() {
  const photo = viewerPhotos[viewerPhotoIndex];
  if (!photo) return;

  photoViewerImage.src = photo.src;
  photoViewerImage.alt = photo.caption;
  photoViewerCaption.textContent = `${photo.caption} (${viewerPhotoIndex + 1}/${viewerPhotos.length})`;
  const hasMultiple = viewerPhotos.length > 1;
  photoViewerPrev.hidden = !hasMultiple;
  photoViewerNext.hidden = !hasMultiple;
}

function showAdjacentPhoto(direction) {
  if (!viewerPhotos.length) return;
  viewerPhotoIndex = (viewerPhotoIndex + direction + viewerPhotos.length) % viewerPhotos.length;
  renderViewerPhoto();
}

function closePhotoViewer() {
  if (photoViewer.hidden) return;
  photoViewer.hidden = true;
  photoViewerImage.src = "";
  photoViewerCaption.textContent = "";
  viewerPhotos = [];
  viewerPhotoIndex = 0;
  if (checkEditor.hidden) document.body.classList.remove("viewer-open");
}

function renderStores() {
  const stores = getStores();
  storesList.innerHTML = "";
  storesSummary.textContent = stores.length
    ? `${stores.length} winkel${stores.length === 1 ? "" : "s"} met opgeslagen checks`
    : "Nog geen winkels opgeslagen.";

  if (!stores.length) {
    renderCheckCards(storeChecks, [], "Sla eerst een storecheck op.");
    return;
  }

  if (!selectedStoreKey || !stores.some((store) => store.key === selectedStoreKey)) {
    selectedStoreKey = stores[0].key;
  }

  stores.forEach((store) => {
    const button = document.createElement("button");
    button.className = "store-row";
    button.classList.toggle("active", store.key === selectedStoreKey);
    button.type = "button";
    button.innerHTML = `
      <span>
        <strong>${escapeHtml(store.chain)}</strong>
        <small>${escapeHtml(store.location)} · ${escapeHtml(store.country)}</small>
      </span>
      <em>${store.checks.length}</em>
    `;
    button.addEventListener("click", () => {
      selectedStoreKey = store.key;
      renderStores();
    });
    storesList.append(button);
  });

  const selectedStore = stores.find((store) => store.key === selectedStoreKey);
  renderCheckCards(storeChecks, selectedStore ? selectedStore.checks : [], "Geen checks voor deze winkel.");
}

function countLegacyPhotos() {
  return checks.reduce(
    (total, check) => total + (check.photos || []).filter((photo) => photo.path && !photo.thumbPath).length,
    0,
  );
}

function renderOptimizeButton() {
  const legacy = countLegacyPhotos();
  optimizeButton.hidden = !firebase || !currentUser || legacy === 0;
  optimizeButton.textContent = `Optimaliseer ${legacy} foto${legacy === 1 ? "" : "'s"}`;
}

async function optimizeExistingPhotos() {
  const targets = checks.filter((check) => (check.photos || []).some((photo) => photo.path && !photo.thumbPath));
  if (!targets.length) return;

  const total = countLegacyPhotos();
  if (!confirm(`${total} foto('s) worden verkleind en opnieuw opgeslagen. Dit kan even duren. Doorgaan?`)) return;

  optimizeButton.disabled = true;
  let done = 0;
  let failed = 0;

  try {
    for (const check of targets) {
      const updatedPhotos = [];
      let changed = false;

      for (const photo of check.photos || []) {
        if (!photo.path || photo.thumbPath) {
          updatedPhotos.push(photo);
          continue;
        }

        done += 1;
        optimizeButton.textContent = `Optimaliseren ${done}/${total}`;
        await waitForPaint();

        try {
          updatedPhotos.push(await optimizeSinglePhoto(photo));
          changed = true;
        } catch (error) {
          console.error(error);
          failed += 1;
          updatedPhotos.push(photo);
        }
      }

      if (changed) await updateDoc(doc(firebase.db, COLLECTION_NAME, check.id), { photos: updatedPhotos });
    }

    alert(failed ? `Klaar, maar ${failed} foto('s) zijn niet gelukt.` : "Alle foto's zijn geoptimaliseerd.");
  } catch (error) {
    console.error(error);
    alert(`Optimaliseren is niet gelukt: ${error.message || error}`);
  } finally {
    optimizeButton.disabled = false;
    renderOptimizeButton();
  }
}

async function optimizeSinglePhoto(photo) {
  const blob = await photoToBlob(photo);
  if (!blob) throw new Error(`${photo.name || "foto"} kon niet worden opgehaald.`);

  const bitmap = await loadBitmap(blob);
  const mime = outputMime(photo.type || blob.type);
  const fullBlob = await resizeToBlob(bitmap, FULL_MAX, mime);
  const thumbBlob = await resizeToBlob(bitmap, THUMB_MAX, mime);
  bitmap.close();

  const thumbPath = photo.path.replace(/([^/]+)$/, "thumb-$1");
  const fullRef = ref(firebase.storage, photo.path);
  const thumbRef = ref(firebase.storage, thumbPath);

  await Promise.all([
    uploadBytes(fullRef, fullBlob, { contentType: mime, cacheControl: CACHE_CONTROL }),
    uploadBytes(thumbRef, thumbBlob, { contentType: mime, cacheControl: CACHE_CONTROL }),
  ]);

  const [url, thumbUrl] = await Promise.all([getDownloadURL(fullRef), getDownloadURL(thumbRef)]);

  return {
    ...photo,
    type: mime,
    url,
    thumbPath: thumbRef.fullPath,
    thumbUrl,
    size: fullBlob.size,
  };
}

function renderStats() {
  const latest = checks
    .map(getCheckDate)
    .filter(Boolean)
    .sort()
    .at(-1);

  totalChecks.textContent = checks.length;
  latestVisit.textContent = latest ? formatShortDate(latest) : "-";
}

function getSelectedExportChecks() {
  const storeKeys = exportFilters.stores;
  return checks.filter((check) => {
    if (exportFilters.countries.size && !exportFilters.countries.has(check.country)) return false;
    if (storeKeys.size && !storeKeys.has(getStoreKey(check))) return false;
    if (exportFilters.years.size && !exportFilters.years.has(getYear(getCheckDate(check)))) return false;
    return true;
  });
}

function getStoreKey(check) {
  return [check.country, check.chain, check.location]
    .map((value) => slugify(value || "onbekend"))
    .join("__");
}

function getExportFileName() {
  const parts = ["storechecks"];

  if (exportFilters.countries.size === 1) parts.push(slugify([...exportFilters.countries][0]));
  else if (exportFilters.countries.size > 1) parts.push(`${exportFilters.countries.size}-landen`);

  if (exportFilters.stores.size === 1) {
    const store = getStores().find((item) => item.key === [...exportFilters.stores][0]);
    if (store) parts.push(slugify(`${store.chain}-${store.location}`));
  } else if (exportFilters.stores.size > 1) {
    parts.push(`${exportFilters.stores.size}-winkels`);
  }

  if (exportFilters.years.size === 1) parts.push([...exportFilters.years][0]);
  else if (exportFilters.years.size > 1) parts.push(`${exportFilters.years.size}-jaren`);

  if (parts.length === 1) parts.push("alles", today);
  return parts.join("-");
}

function getCountries() {
  return [...new Set(checks.map((check) => check.country).filter(Boolean))].sort();
}

function getStores() {
  const grouped = new Map();
  checks.forEach((check) => {
    const key = getStoreKey(check);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        chain: check.chain || "Onbekende keten",
        country: check.country || "Onbekend land",
        location: check.location || "Onbekend filiaal",
        checks: [],
      });
    }
    grouped.get(key).checks.push(check);
  });

  return [...grouped.values()].sort((a, b) => a.chain.localeCompare(b.chain) || a.location.localeCompare(b.location));
}

function getYears() {
  return [...new Set(checks.map((check) => getYear(getCheckDate(check))).filter(Boolean))].sort().reverse();
}

function getYear(value) {
  return value ? String(value).slice(0, 4) : "";
}

function getCheckDate(check) {
  return check.visitDate || check.photoDate || "";
}

function toExportCheck(check) {
  return {
    id: check.id,
    chain: check.chain,
    country: check.country,
    location: check.location,
    date: getCheckDate(check),
    notes: check.notes || "",
    createdAt: check.createdAt || "",
    photos: (check.photos || []).map((photo) => ({
      name: photo.name,
      type: photo.type,
      path: photo.path || "",
      url: photo.url || "",
    })),
  };
}

async function addCheckPhotosToZip(zip, check, exportState) {
  const folderPath = [
    "photos",
    slugify(check.country || "onbekend-land"),
    slugify(check.chain || "onbekende-keten"),
    slugify(check.location || "onbekend-filiaal"),
    getCheckDate(check) || "zonder-datum",
  ].join("/");

  for (const [index, photo] of (check.photos || []).entries()) {
    exportState.done += 1;
    downloadZipButton.textContent = `Foto ${exportState.done}/${exportState.total} downloaden`;
    await waitForPaint();

    try {
      const blob = await photoToBlob(photo);
      if (!blob) {
        exportState.errors.push(`${check.chain} / ${check.location}: ${photo.name || `foto ${index + 1}`} kon niet worden gevonden.`);
        continue;
      }
      const extension = getPhotoExtension(photo, blob);
      const baseName = stripExtension(photo.name) || `foto-${index + 1}`;
      const fileName = `${String(index + 1).padStart(2, "0")}-${slugify(baseName)}${extension}`;
      zip.file(`${folderPath}/${fileName}`, blob, { compression: "STORE" });
    } catch (error) {
      console.error(error);
      exportState.errors.push(`${check.chain} / ${check.location}: ${photo.name || `foto ${index + 1}`} kon niet worden toegevoegd.`);
    }
  }
}

async function photoToBlob(photo) {
  if (photo.data) return dataUrlToBlob(photo.data);

  const url = photo.url || (firebase && photo.path
    ? await withPromiseTimeout(getDownloadURL(ref(firebase.storage, photo.path)), 8000, "Downloadlink ophalen duurde te lang")
    : "");

  if (url) {
    try {
      return await fetchBlobWithTimeout(url, 20000, photo.name || "foto");
    } catch (error) {
      console.warn("Fetch van foto mislukt, probeer Firebase SDK:", error);
    }
  }

  if (firebase && photo.path) {
    try {
      return await withPromiseTimeout(getBlob(ref(firebase.storage, photo.path)), 20000, "Foto ophalen duurde te lang");
    } catch (error) {
      console.error(error);
      throw new Error(`${photo.name || "foto"} kon niet worden opgehaald (mogelijk CORS op de storage bucket).`);
    }
  }

  return null;
}

function withPromiseTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]);
}

async function fetchBlobWithTimeout(url, milliseconds, photoName) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), milliseconds);
  let response;

  try {
    response = await fetch(url, {
      cache: "no-store",
      mode: "cors",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }

  if (!response.ok) throw new Error(`Foto niet bereikbaar: ${photoName}`);
  return response.blob();
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function getPhotoExtension(photo, blob) {
  const existing = photo.name && photo.name.match(/\.[a-z0-9]+$/i);
  if (existing) return existing[0].toLowerCase();
  if (blob.type === "image/png") return ".png";
  if (blob.type === "image/webp") return ".webp";
  return ".jpg";
}

function stripExtension(name = "") {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "onbekend";
}

function downloadBlob(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }, 60000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[char]);
}

async function deleteCheck(id) {
  const check = checks.find((item) => item.id === id);
  if (!check) return;

  const photoCount = (check.photos || []).length;
  const label = [check.chain, check.location].filter(Boolean).join(" - ") || "Deze storecheck";
  const message = `${label} verwijderen?\n\n${photoCount} foto${photoCount === 1 ? "" : "'s"} worden ook definitief verwijderd. Dit kan niet ongedaan gemaakt worden.`;
  if (!confirm(message)) return;

  if (editingCheckId === id) closeCheckEditor();

  if (firebase) {
    await deleteDoc(doc(firebase.db, COLLECTION_NAME, id));
    const photoDeletes = (check.photos || [])
      .flatMap((photo) => [photo.path, photo.thumbPath])
      .filter(Boolean)
      .map((path) => deleteObject(ref(firebase.storage, path)).catch(() => null));
    await Promise.all(photoDeletes);
    return;
  }

  checks = checks.filter((item) => item.id !== id);
  persistLocal();
  renderChecks();
}

async function exportChecksZip() {
  const selectedChecks = getSelectedExportChecks();
  if (!selectedChecks.length) {
    alert("Er zijn geen storechecks voor deze export.");
    return;
  }

  const originalText = downloadZipButton.textContent;
  downloadZipButton.disabled = true;
  downloadZipButton.textContent = "ZIP voorbereiden...";

  try {
    const JSZip = await loadZipLibrary();
    const zip = new JSZip();
    const photoTotal = selectedChecks.reduce((total, check) => total + (check.photos || []).length, 0);
    const exportState = { done: 0, errors: [], total: photoTotal };
    const cleanChecks = selectedChecks.map(toExportCheck);
    zip.file("storechecks.json", JSON.stringify(cleanChecks, null, 2));
    zip.file("fotolinks.csv", buildPhotoLinksCsv(selectedChecks));

    for (const check of selectedChecks) {
      await addCheckPhotosToZip(zip, check, exportState);
    }

    if (exportState.errors.length) {
      zip.file("export-waarschuwingen.txt", exportState.errors.join("\n"));
    }

    downloadZipButton.textContent = "ZIP afronden...";
    await waitForPaint();
    const blob = await zip.generateAsync(
      { type: "blob", compression: "STORE" },
      (metadata) => {
        downloadZipButton.textContent = `ZIP ${Math.round(metadata.percent)}%`;
      },
    );
    downloadBlob(blob, `${getExportFileName()}.zip`);
    closeExportDialog();
    if (exportState.errors.length) {
      alert(`ZIP gemaakt, maar ${exportState.errors.length} foto${exportState.errors.length === 1 ? "" : "'s"} konden niet worden toegevoegd. Zie export-waarschuwingen.txt in de ZIP.`);
    }
  } catch (error) {
    console.error(error);
    alert(`Exporteren is niet gelukt: ${error.message || error}`);
  } finally {
    downloadZipButton.disabled = false;
    downloadZipButton.textContent = originalText;
  }
}

async function loadZipLibrary() {
  const module = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
  return module.default;
}

function waitForPaint() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function buildPhotoLinksCsv(list) {
  const rows = [["Keten", "Land", "Filiaal", "Datum", "Foto", "Link"]];
  list.forEach((check) => {
    (check.photos || []).forEach((photo, index) => {
      rows.push([
        check.chain || "",
        check.country || "",
        check.location || "",
        getCheckDate(check),
        photo.name || `Foto ${index + 1}`,
        photo.url || photo.path || "",
      ]);
    });
  });

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildExportHtml(list) {
  const items = list.map((check) => {
    const photos = (check.photos || []).map((photo, index) => {
      const url = photo.url || "";
      const label = escapeHtml(photo.name || `Foto ${index + 1}`);
      return url ? `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${label}</a></li>` : `<li>${label}</li>`;
    }).join("");

    return `
      <article>
        <h2>${escapeHtml(check.chain || "Storecheck")}</h2>
        <p><strong>Land:</strong> ${escapeHtml(check.country || "")}</p>
        <p><strong>Filiaal:</strong> ${escapeHtml(check.location || "")}</p>
        <p><strong>Datum:</strong> ${escapeHtml(formatDate(getCheckDate(check)))}</p>
        <p><strong>Notities:</strong> ${escapeHtml(check.notes || "Geen notities.")}</p>
        <h3>Foto's</h3>
        <ul>${photos || "<li>Geen foto's</li>"}</ul>
      </article>
    `;
  }).join("");

  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <title>Storechecks export</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #111315; }
    article { border-bottom: 1px solid #d8e3e7; padding: 18px 0; }
    h1, h2 { margin-bottom: 8px; }
    a { color: #269200; }
  </style>
</head>
<body>
  <h1>Storechecks export</h1>
  ${items}
</body>
</html>`;
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "short" }).format(new Date(`${value}T00:00:00`));
}
