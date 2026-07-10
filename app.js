const STORAGE_KEY = "storechecks.v1";

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

let checks = loadChecks();

const today = new Date().toISOString().slice(0, 10);
visitDate.value = today;
photoDate.value = today;

photoInput.addEventListener("change", renderPreview);
form.addEventListener("submit", saveCheck);
searchFilter.addEventListener("input", renderChecks);
countryFilter.addEventListener("change", renderChecks);
categoryFilter.addEventListener("change", renderChecks);
exportButton.addEventListener("click", exportChecks);
importInput.addEventListener("change", importChecks);
clearButton.addEventListener("click", clearChecks);

renderCountryFilter();
renderChecks();

function loadChecks() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persist() {
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
  const data = new FormData(form);
  const photos = await Promise.all([...photoInput.files].map(fileToPhoto));

  checks.unshift({
    id: crypto.randomUUID(),
    chain: data.get("chain").trim(),
    country: data.get("country"),
    location: data.get("location").trim(),
    visitDate: data.get("visitDate"),
    photoDate: data.get("photoDate"),
    category: data.get("category"),
    notes: data.get("notes").trim(),
    photos,
    createdAt: new Date().toISOString(),
  });

  persist();
  form.reset();
  visitDate.value = today;
  photoDate.value = today;
  preview.innerHTML = "";
  renderCountryFilter();
  renderChecks();
}

function fileToPhoto(file) {
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
  summary.textContent = `${checks.length} opgeslagen check${checks.length === 1 ? "" : "s"} · ${filtered.length} zichtbaar`;

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
    check.photos.forEach((photo) => {
      const img = document.createElement("img");
      img.src = photo.data;
      img.alt = `${check.chain} - ${photo.name}`;
      gallery.append(img);
    });

    checksEl.append(card);
  });
}

function matchesFilters(check) {
  const query = searchFilter.value.trim().toLowerCase();
  const text = [check.chain, check.country, check.location, check.category, check.notes].join(" ").toLowerCase();
  return (
    (!query || text.includes(query)) &&
    (!countryFilter.value || check.country === countryFilter.value) &&
    (!categoryFilter.value || check.category === categoryFilter.value)
  );
}

function deleteCheck(id) {
  checks = checks.filter((check) => check.id !== id);
  persist();
  renderCountryFilter();
  renderChecks();
}

function clearChecks() {
  if (!checks.length || !confirm("Alle storechecks wissen?")) return;
  checks = [];
  persist();
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

function importChecks(event) {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error("Geen lijst");
      checks = imported;
      persist();
      renderCountryFilter();
      renderChecks();
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
