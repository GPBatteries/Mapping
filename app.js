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
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import {
  deleteObject,
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
const form = document.querySelector("#checkForm");
const photoInput = document.querySelector("#photos");
const preview = document.querySelector("#preview");
const checksEl = document.querySelector("#checks");
const template = document.querySelector("#checkTemplate");
const summary = document.querySelector("#summary");
const searchFilter = document.querySelector("#searchFilter");
const countryFilter = document.querySelector("#countryFilter");
const exportButton = document.querySelector("#exportButton");
const exportMenu = document.querySelector("#exportMenu");
const exportScope = document.querySelector("#exportScope");
const exportValue = document.querySelector("#exportValue");
const exportValueLabel = document.querySelector("#exportValueLabel");
const downloadZipButton = document.querySelector("#downloadZipButton");
const importInput = document.querySelector("#importInput");
const clearButton = document.querySelector("#clearButton");
const visitDate = document.querySelector("#visitDate");
const syncStatus = document.querySelector("#syncStatus");
const totalChecks = document.querySelector("#totalChecks");
const totalPhotos = document.querySelector("#totalPhotos");
const totalCountries = document.querySelector("#totalCountries");
const latestVisit = document.querySelector("#latestVisit");

let checks = [];
let firebase = null;
let currentUser = null;
let unsubscribeChecks = null;

const today = new Date().toISOString().slice(0, 10);
visitDate.value = today;

loginButton.addEventListener("click", login);
loginButtonHeader.addEventListener("click", login);
logoutButton.addEventListener("click", logout);
photoInput.addEventListener("change", renderPreview);
form.addEventListener("submit", saveCheck);
searchFilter.addEventListener("input", renderChecks);
countryFilter.addEventListener("change", renderChecks);
exportButton.addEventListener("click", toggleExportMenu);
exportScope.addEventListener("change", renderExportOptions);
downloadZipButton.addEventListener("click", exportChecksZip);
importInput.addEventListener("change", importChecks);
clearButton.addEventListener("click", clearChecks);
document.addEventListener("click", closeExportMenu);

startApp();

function startApp() {
  firebase = createFirebaseClient();

  if (!firebase) {
    checks = loadLocalChecks();
    setStatus("Lokale opslag actief");
    showApp();
    renderCountryFilter();
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
    renderCountryFilter();
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
  importInput.closest("label").hidden = true;
  setStatus("Niet ingelogd");
}

function showApp(user) {
  loginPortal.hidden = true;
  appLayout.hidden = false;
  loginButtonHeader.hidden = true;
  logoutButton.hidden = !firebase;
  userBadge.hidden = !user;
  exportButton.hidden = false;
  importInput.closest("label").hidden = false;
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
      renderCountryFilter();
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
      renderCountryFilter();
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

function renderCountryFilter() {
  const selected = countryFilter.value;
  const countries = getCountries();
  countryFilter.innerHTML = '<option value="">Alle landen</option>';
  countries.forEach((country) => {
    const option = document.createElement("option");
    option.value = country;
    option.textContent = country;
    countryFilter.append(option);
  });
  countryFilter.value = selected;
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
  const filtered = checks.filter(matchesFilters);
  checksEl.innerHTML = "";
  summary.textContent = `${checks.length} opgeslagen check${checks.length === 1 ? "" : "s"} - ${filtered.length} zichtbaar`;
  renderStats();
  renderExportOptions();

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = checks.length ? "Geen checks voor deze filters." : "Voeg je eerste winkelbezoek toe.";
    checksEl.append(empty);
    return;
  }

  filtered.forEach((check) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector(".country").textContent = check.country;
    card.querySelector("h3").textContent = check.chain;
    card.querySelector(".location").textContent = check.location;
    card.querySelector(".visit-date").textContent = formatDate(getCheckDate(check));
    card.querySelector(".photo-count").textContent = `${(check.photos || []).length}`;
    card.querySelector(".notes").textContent = check.notes || "Geen notities.";
    card.querySelector(".delete-button").addEventListener("click", () => deleteCheck(check.id));

    const gallery = card.querySelector(".gallery");
    (check.photos || []).forEach((photo) => {
      const img = document.createElement("img");
      img.src = photo.url || photo.data;
      img.alt = `${check.chain} - ${photo.name}`;
      gallery.append(img);
    });

    checksEl.append(card);
  });
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

function matchesFilters(check) {
  const queryText = searchFilter.value.trim().toLowerCase();
  const searchable = [check.chain, check.country, check.location, check.notes].join(" ").toLowerCase();
  return (
    (!queryText || searchable.includes(queryText)) &&
    (!countryFilter.value || check.country === countryFilter.value)
  );
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

async function addCheckPhotosToZip(zip, check) {
  const folderPath = [
    "photos",
    slugify(check.country || "onbekend-land"),
    slugify(check.chain || "onbekende-keten"),
    slugify(check.location || "onbekend-filiaal"),
    getCheckDate(check) || "zonder-datum",
  ].join("/");

  for (const [index, photo] of (check.photos || []).entries()) {
    const blob = await photoToBlob(photo);
    if (!blob) continue;
    const extension = getPhotoExtension(photo, blob);
    const baseName = stripExtension(photo.name) || `foto-${index + 1}`;
    zip.file(`${folderPath}/${slugify(baseName)}${extension}`, blob);
  }
}

async function photoToBlob(photo) {
  if (photo.data) return dataUrlToBlob(photo.data);
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

async function deleteCheck(id) {
  const check = checks.find((item) => item.id === id);
  if (!check) return;

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
  renderCountryFilter();
  renderChecks();
}

async function clearChecks() {
  if (!checks.length || !confirm("Alle storechecks wissen?")) return;

  if (firebase) {
    const checksQuery = query(collection(firebase.db, COLLECTION_NAME), where("ownerUid", "==", currentUser.uid));
    const snapshot = await getDocs(checksQuery);
    await Promise.all(snapshot.docs.map((document) => deleteDoc(document.ref)));
    const photoDeletes = checks.flatMap((check) =>
      (check.photos || [])
        .filter((photo) => photo.path)
        .map((photo) => deleteObject(ref(firebase.storage, photo.path)).catch(() => null)),
    );
    await Promise.all(photoDeletes);
    return;
  }

  checks = [];
  persistLocal();
  renderCountryFilter();
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
    const cleanChecks = selectedChecks.map(toExportCheck);
    zip.file("storechecks.json", JSON.stringify(cleanChecks, null, 2));

    for (const check of selectedChecks) {
      await addCheckPhotosToZip(zip, check);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${getExportFileName()}.zip`);
    exportMenu.hidden = true;
  } catch (error) {
    console.error(error);
    alert("Exporteren is niet gelukt. Controleer of de foto's nog toegankelijk zijn.");
  } finally {
    downloadZipButton.disabled = false;
    downloadZipButton.textContent = originalText;
  }
}

async function importChecks(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error("Geen lijst");

      if (firebase) {
        await Promise.all(
          imported.map(({ id, ...check }) =>
            addDoc(collection(firebase.db, COLLECTION_NAME), {
              ...check,
              ownerUid: currentUser.uid,
              ownerEmail: currentUser.email || "",
            }),
          ),
        );
      } else {
        checks = imported;
        persistLocal();
        renderCountryFilter();
        renderChecks();
      }
    } catch {
      alert("Dit JSON-bestand kon niet worden geimporteerd.");
    } finally {
      importInput.value = "";
    }
  };
  reader.readAsText(file);
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "short" }).format(new Date(`${value}T00:00:00`));
}
