# Storechecks website

Een statische GitHub Pages-website voor winkelbezoeken in Italie en Frankrijk.
Met Firebase kunnen foto's en bezoekgegevens blijvend online worden opgeslagen.

## Wat je kunt vastleggen

- Keten
- Land
- Filiaal of locatie
- Bezoekdatum
- Fotodatum
- Categorie: batterijen, accessoires of beide
- Notities
- Meerdere foto's per bezoek

## Opslag

Zonder Firebase-configuratie gebruikt de site lokale browseropslag. Met Firebase-configuratie gebruikt de site:

- Firestore voor winkelbezoeken en metadata
- Firebase Storage voor foto's

## Firebase instellen

1. Maak een Firebase-project aan via de Firebase Console.
2. Voeg een Web App toe aan het project.
3. Kopieer de Firebase-configuratie.
4. Open `firebase-config.js`.
5. Vul de waarden in bij `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` en `appId`.
6. Zet Cloud Firestore aan.
7. Zet Firebase Storage aan.
8. Gebruik de regels uit `firebase-rules.md` om te testen.

De Firebase-webconfig is geen geheim wachtwoord. De beveiliging gebeurt via Firestore- en Storage-regels.

## Belangrijk bij lokale opslag

Als `firebase-config.js` leeg blijft, heeft deze site geen server of database. De gegevens en foto's worden dan in de browser opgeslagen met `localStorage`.

Gebruik daarom regelmatig de exportknop. Daarmee download je een JSON-bestand met alle storechecks en foto's. Op een andere computer of browser kun je dat bestand weer importeren.

## Publiceren op GitHub Pages

1. Maak een nieuwe GitHub-repository aan.
2. Upload `index.html`, `styles.css`, `app.js` en deze `README.md`.
3. Ga in GitHub naar `Settings` > `Pages`.
4. Kies als bron `Deploy from a branch`.
5. Kies de branch `main` en de map `/root`.
6. Sla op. GitHub toont daarna de publieke website-link.

## Lokaal openen

Door de Firebase-module werkt lokaal testen het beste via een kleine lokale webserver of direct via GitHub Pages.
