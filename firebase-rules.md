# Firebase regels

Gebruik deze regels alleen voor een persoonlijke, simpele start. Vervang `jouw@email.com` door je eigen Google-account als je later Firebase Authentication toevoegt.

## Aanbevolen regels met Google-login

Deze regels laten alleen ingelogde gebruikers hun eigen storechecks en foto's lezen en schrijven.

```txt
// Firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /storechecks/{document} {
      allow read, update, delete: if request.auth != null
        && resource.data.ownerUid == request.auth.uid;

      allow create: if request.auth != null
        && request.resource.data.ownerUid == request.auth.uid;
    }

    match /exportJobs/{document} {
      allow read: if request.auth != null
        && resource.data.ownerUid == request.auth.uid;

      allow create: if request.auth != null
        && request.resource.data.ownerUid == request.auth.uid;
    }
  }
}
```

```txt
// Storage
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /storechecks/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }

    match /exports/{userId}/{allPaths=**} {
      allow read: if request.auth != null
        && request.auth.uid == userId;
    }
  }
}
```

## Snelle testregels

Gebruik openbare testregels alleen heel kort als je nog aan het debuggen bent. Zet daarna de regels hierboven terug.
