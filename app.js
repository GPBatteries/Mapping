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
const categoryFilter = document.querySelector("#categoryFilter");
const exportButton = document.querySelector("#exportButton");
const importInput = document.querySelector("#importInput");
const clearButton = document.querySelector("#clearButton");
const visitDate = document.querySelector("#visitDate");
const photoDate = document.querySelector("#photoDate");
const syncStatus = document.querySelector("#syncStatus");

let checks = [];
let firebase = null;
let currentUser = null;
let unsubscribeChecks = null;

const today = new Date().toISOString().slice(0, 10);
visitDate.value = today;
photoDate.value = today;

loginButton.addEventListener("click", login);
loginButtonHeader.addEventListener("click", login);
logoutButton.addEventListener("click", logout);
photoInput.addEventListener("change", renderPreview);
form.addEventListener("submit", saveCheck);
searchFilter.addEventListener("input", renderChecks);
countryFilter.addEventListener("change", renderChecks);
categoryFilter.addEventListener("change", renderChecks);
exportButton.addEventListener("click", exportChecks);
importInput.addEventListener("change", importChecks);
clearButton.addEventListener("click", clearChecks);

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
      photoDate: data.get("photoDate"),
      category: data.get("category"),
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
    photoDate.value = today;
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
  const countries = [...new Set(checks.map((check) => check.country).filter(Boolean))].sort();
  countryFilter.innerHTML = '<option value="">Alle landen</option>';
  countries.forEach((country) => {
    const option = document.createElement("option");
    option.value = country;
    option.textContent = country;
    countryFilter.append(option);
  });
  countryFilter.value = selected;
}

function renderChecks() {
  const filtered = checks.filter(matchesFilters);
  checksEl.innerHTML = "";
  summary.textContent = `${checks.length} opgeslagen check${checks.length === 1 ? "" : "s"} - ${filtered.length} zichtbaar`;

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
    card.querySelector(".visit-date").textContent = formatDate(check.visitDate);
    card.querySelector(".photo-date").textContent = formatDate(check.photoDate);
    card.querySelector(".category").textContent = check.category;
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

function matchesFilters(check) {
  const queryText = searchFilter.value.trim().toLowerCase();
  const searchable = [check.chain, check.country, check.location, check.category, check.notes].join(" ").toLowerCase();
  return (
    (!queryText || searchable.includes(queryText)) &&
    (!countryFilter.value || check.country === countryFilter.value) &&
    (!categoryFilter.value || check.category === categoryFilter.value)
  );
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

function exportChecks() {
  const blob = new Blob([JSON.stringify(checks, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `storechecks-${today}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
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
