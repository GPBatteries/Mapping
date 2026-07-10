# Storechecks website

Een statische GitHub Pages-website voor winkelbezoeken in Italie en Frankrijk.

## Wat je kunt vastleggen

- Keten
- Land
- Filiaal of locatie
- Bezoekdatum
- Fotodatum
- Categorie: batterijen, accessoires of beide
- Notities
- Meerdere foto's per bezoek

## Belangrijk

Deze site heeft geen server of database. De gegevens en foto's worden in de browser opgeslagen met `localStorage`.

Gebruik daarom regelmatig de exportknop. Daarmee download je een JSON-bestand met alle storechecks en foto's. Op een andere computer of browser kun je dat bestand weer importeren.

## Publiceren op GitHub Pages

1. Maak een nieuwe GitHub-repository aan.
2. Upload `index.html`, `styles.css`, `app.js` en deze `README.md`.
3. Ga in GitHub naar `Settings` > `Pages`.
4. Kies als bron `Deploy from a branch`.
5. Kies de branch `main` en de map `/root`.
6. Sla op. GitHub toont daarna de publieke website-link.

## Lokaal openen

Open `index.html` in je browser.
