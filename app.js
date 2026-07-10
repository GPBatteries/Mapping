import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
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
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import {
  deleteObject,
  getBlob,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";
import { firebaseConfig } from "./firebase-config.js";

const STORAGE_KEY = "storechecks.v1";
const COLLECTION_NAME = "storechecks";

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
const exportButton = document.querySelector("#exportButton");
const exportMenu = document.querySelector("#exportMenu");
const exportScope = document.querySelector("#exportScope");
const exportValue = document.querySelector("#exportValue");
const exportValueLabel = document.querySelector("#exportValueLabel");
const downloadZipButton = document.querySelector("#downloadZipButton");
const visitDate = document.querySelector("#visitDate");
const syncStatus = document.querySelector("#syncStatus");
const totalChecks = document.querySelector("#totalChecks");
const totalPhotos = document.querySelector("#totalPhotos");
const totalCountries = document.querySelector("#totalCountries");
const latestVisit = document.querySelector("#latestVisit");
const photoViewer = document.querySelector("#photoViewer");
const photoViewerImage = document.querySelector("#photoViewerImage");
const photoViewerCaption = document.querySelector("#photoViewerCaption");
const photoViewerClose = document.querySelector("#photoViewerClose");
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

const today = new Date().toISOString().slice(0, 10);
visitDate.value = today;

loginButton.addEventListener("click", login);
loginButtonHeader.addEventListener("click", login);
logoutButton.addEventListener("click", logout);
navButtons.forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
photoInput.addEventListener("change", renderPreview);
form.addEventListener("submit", saveCheck);
exportButton.addEventListener("click", toggleExportMenu);
exportScope.addEventListener("change", renderExportOptions);
downloadZipButton.addEventListener("click", exportChecksZip);
document.addEventListener("click", closeExportMenu);
photoViewerClose.addEventListener("click", closePhotoViewer);
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
  }
});

startApp();

function startApp() {
  firebase = createFirebaseClient();

  if (!firebase) {
    checks = loadLocalChecks();
    setStatus("Lokale opslag actief");
    showApp();
    renderChecks();
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
  exportMenu.hidden = true;
  setStatus("Niet ingelogd");
}

function showApp(user) {
  loginPortal.hidden = true;
  appLayout.hidden = false;
  loginButtonHeader.hidden = true;
  logoutButton.hidden = !firebase;
  userBadge.hidden = !user;
  exportButton.hidden = false;
  renderExportOptions();

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

async function uploadPhoto(file, checkId) {
  const safeName = file.name.replace(/[^\w.-]/g, "_");
  const path = `${COLLECTION_NAME}/${currentUser.uid}/${checkId}/${Date.now()}-${safeName}`;
  const storageRef = ref(firebase.storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  return { name: file.name, type: file.type, path, url };
}

function fileToLocalPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderExportOptions() {
  const scope = exportScope.value;
  const values = scope === "country" ? getCountries() : scope === "year" ? getYears() : [];

  exportValue.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    exportValue.append(option);
  });

  exportValueLabel.hidden = scope === "all";
  downloadZipButton.disabled = scope !== "all" && !values.length;
}

function renderChecks() {
  renderStats();
  renderExportOptions();
  renderDashboardChecks();
  renderStores();
  if (editingCheckId && !checkEditor.hidden) renderCheckEditor();
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
    (check.photos || []).forEach((photo) => {
      const img = document.createElement("img");
      img.src = photo.url || photo.data;
      img.alt = `${check.chain} - ${photo.name}`;
      img.tabIndex = 0;
      img.addEventListener("click", (event) => {
        event.stopPropagation();
        openPhotoViewer(img.src, img.alt);
      });
      img.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          openPhotoViewer(img.src, img.alt);
        }
      });
      gallery.append(img);
    });

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
    img.src = photo.url || photo.data;
    img.alt = `${check.chain} - ${photo.name}`;
    img.addEventListener("click", () => openPhotoViewer(img.src, img.alt));

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
    if (firebase && photo.path) {
      await deleteObject(ref(firebase.storage, photo.path)).catch(() => null);
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

function openPhotoViewer(src, caption) {
  photoViewerImage.src = src;
  photoViewerImage.alt = caption;
  photoViewerCaption.textContent = caption;
  photoViewer.hidden = false;
  document.body.classList.add("viewer-open");
  photoViewerClose.focus();
}

function closePhotoViewer() {
  if (photoViewer.hidden) return;
  photoViewer.hidden = true;
  photoViewerImage.src = "";
  photoViewerCaption.textContent = "";
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

function renderStats() {
  const photoCount = checks.reduce((total, check) => total + (check.photos || []).length, 0);
  const countries = new Set(checks.map((check) => check.country).filter(Boolean));
  const latest = checks
    .map(getCheckDate)
    .filter(Boolean)
    .sort()
    .at(-1);

  totalChecks.textContent = checks.length;
  totalPhotos.textContent = photoCount;
  totalCountries.textContent = countries.size;
  latestVisit.textContent = latest ? formatShortDate(latest) : "-";
}

function getSelectedExportChecks() {
  if (exportScope.value === "country") {
    return checks.filter((check) => check.country === exportValue.value);
  }

  if (exportScope.value === "year") {
    return checks.filter((check) => getYear(getCheckDate(check)) === exportValue.value);
  }

  return checks;
}

function getExportFileName() {
  if (exportScope.value === "country") return `storechecks-${slugify(exportValue.value)}`;
  if (exportScope.value === "year") return `storechecks-${exportValue.value}`;
  return `storechecks-alles-${today}`;
}

function getCountries() {
  return [...new Set(checks.map((check) => check.country).filter(Boolean))].sort();
}

function getStores() {
  const grouped = new Map();
  checks.forEach((check) => {
    const key = [check.country, check.chain, check.location].map((value) => slugify(value || "onbekend")).join("__");
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

async function addCheckPhotosToZip(zip, check, exportErrors) {
  const folderPath = [
    "photos",
    slugify(check.country || "onbekend-land"),
    slugify(check.chain || "onbekende-keten"),
    slugify(check.location || "onbekend-filiaal"),
    getCheckDate(check) || "zonder-datum",
  ].join("/");

  for (const [index, photo] of (check.photos || []).entries()) {
    try {
      const blob = await photoToBlob(photo);
      if (!blob) {
        exportErrors.push(`${check.chain} / ${check.location}: ${photo.name || `foto ${index + 1}`} kon niet worden gevonden.`);
        continue;
      }
      const extension = getPhotoExtension(photo, blob);
      const baseName = stripExtension(photo.name) || `foto-${index + 1}`;
      zip.file(`${folderPath}/${slugify(baseName)}${extension}`, blob);
    } catch (error) {
      console.error(error);
      exportErrors.push(`${check.chain} / ${check.location}: ${photo.name || `foto ${index + 1}`} kon niet worden toegevoegd.`);
    }
  }
}

async function photoToBlob(photo) {
  if (photo.data) return dataUrlToBlob(photo.data);
  if (firebase && photo.path) return getBlob(ref(firebase.storage, photo.path));
  if (!photo.url) return null;

  const response = await fetch(photo.url);
  if (!response.ok) throw new Error(`Foto niet bereikbaar: ${photo.name}`);
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
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
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
  if (editingCheckId === id) closeCheckEditor();

  if (firebase) {
    await deleteDoc(doc(firebase.db, COLLECTION_NAME, id));
    const photoDeletes = (check.photos || [])
      .filter((photo) => photo.path)
      .map((photo) => deleteObject(ref(firebase.storage, photo.path)).catch(() => null));
    await Promise.all(photoDeletes);
    return;
  }

  checks = checks.filter((item) => item.id !== id);
  persistLocal();
  renderChecks();
}

function toggleExportMenu(event) {
  event.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
  renderExportOptions();
}

function closeExportMenu(event) {
  if (exportMenu.hidden || event.target.closest(".export-control")) return;
  exportMenu.hidden = true;
}

async function exportChecksZip() {
  const selectedChecks = getSelectedExportChecks();
  if (!selectedChecks.length) {
    alert("Er zijn geen storechecks voor deze export.");
    return;
  }

  const originalText = downloadZipButton.textContent;
  downloadZipButton.disabled = true;
  downloadZipButton.textContent = "ZIP maken...";

  try {
    const zip = new JSZip();
    const exportErrors = [];
    const cleanChecks = selectedChecks.map(toExportCheck);
    zip.file("storechecks.json", JSON.stringify(cleanChecks, null, 2));

    for (const check of selectedChecks) {
      await addCheckPhotosToZip(zip, check, exportErrors);
    }

    if (exportErrors.length) {
      zip.file("export-waarschuwingen.txt", exportErrors.join("\n"));
    }

    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${getExportFileName()}.zip`);
    exportMenu.hidden = true;
    if (exportErrors.length) {
      alert(`ZIP gemaakt, maar ${exportErrors.length} foto${exportErrors.length === 1 ? "" : "'s"} konden niet worden toegevoegd. Zie export-waarschuwingen.txt in de ZIP.`);
    }
  } catch (error) {
    console.error(error);
    alert("Exporteren is niet gelukt. Controleer of de foto's nog toegankelijk zijn.");
  } finally {
    downloadZipButton.disabled = false;
    downloadZipButton.textContent = originalText;
  }
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "short" }).format(new Date(`${value}T00:00:00`));
}
