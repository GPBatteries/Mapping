# Firebase regels

Gebruik deze regels alleen voor een persoonlijke, simpele start. Vervang `jouw@email.com` door je eigen Google-account als je later Firebase Authentication toevoegt.

## Snelle testregels

Deze regels maken lezen en schrijven openbaar. Handig om kort te testen, maar niet geschikt om lang online te laten staan.

```txt
// Firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /storechecks/{document=**} {
      allow read, write: if true;
    }
  }
}
```

```txt
// Storage
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /storechecks/{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

## Betere volgende stap

Zet Firebase Authentication aan en beperk toegang tot jouw account. Dan blijven foto's online opgeslagen, maar niet publiek wijzigbaar.
