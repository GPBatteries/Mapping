# Verificatiemails betrouwbaar laten aankomen (zonder Cloud Function)

## Waarom dit gebeurt
Firebase verstuurt verificatie- en wachtwoord-reset-mails standaard vanaf een
generiek adres zoals `noreply@mapping-ddc45.firebaseapp.com`. Bedrijfsmailfilters
(Microsoft 365 Defender, Mimecast, Proofpoint, etc.) vertrouwen zo'n onbekend
extern adres vaak niet en gooien het bericht stilletjes weg — vaak zelfs vóór de
spamfolder.

## De oplossing: eigen SMTP-server instellen in Firebase
Firebase Authentication kan mails ook versturen via **jouw eigen SMTP-server**,
zodat de afzender bijvoorbeeld `noreply@goldpeak.com` wordt in plaats van het
generieke Firebase-adres. Geen Cloud Function nodig — dit is een instelling in
de Firebase Console zelf.

### Stap 1 — Kies een verzendmethode

**Optie A: Jullie hebben al Google Workspace voor goldpeak.com**
Dan kun je de ingebouwde SMTP-relay van Google Workspace gebruiken. Vraag je
IT-beheerder (of check zelf) of "SMTP relay service" aanstaat in de Google
Workspace Admin Console (Apps → Google Workspace → Gmail → Routing → SMTP relay
service). Dit is vaak de makkelijkste weg omdat het al standaard vertrouwd wordt
door jullie eigen mailomgeving.

**Optie B: Een losse transactionele e-maildienst**
Als er geen Workspace SMTP-relay is (of je wilt dat niet gebruiken), kies een
dienst als:
- **Resend** (https://resend.com) — eenvoudig, genereuze gratis laag
- **Postmark** (https://postmarkapp.com) — betrouwbaar voor transactionele mail
- **SendGrid** (https://sendgrid.com)

Bij elk van deze maak je een account, en voeg je een **subdomein** toe om vanaf
te versturen, bijvoorbeeld `mail.goldpeak.com` of gewoon `goldpeak.com` zelf.

### Stap 2 — Domein verifiëren (SPF/DKIM/DMARC)

Elke dienst hierboven vraagt je om een paar DNS-records toe te voegen bij het
domein `goldpeak.com` (via wie ook de DNS van dat domein beheert — vaak
dezelfde plek als waar de website/e-mail geregeld is):
- Een **SPF**-record (TXT)
- Een of meer **DKIM**-records (TXT of CNAME)
- Eventueel een **DMARC**-record (TXT)

Dit bevestigt aan ontvangende mailservers dat de dienst namens `goldpeak.com`
mag versturen — zonder dit stap blijft de mail alsnog onbetrouwbaar overkomen.
Dit moet je (of je IT-beheerder) eenmalig doen bij wie de DNS van `goldpeak.com`
beheert.

### Stap 3 — SMTP instellen in Firebase

1. Ga naar **Firebase Console → Authentication → Templates**.
2. Zoek de sectie **SMTP-instellingen** (soms "Custom SMTP" genoemd, bovenaan
   of via een tandwiel-icoon bij de templates).
3. Zet "Aangepaste SMTP-server gebruiken" aan en vul in:
   - **Host**: bijv. `smtp.resend.com` (afhankelijk van je gekozen dienst)
   - **Poort**: meestal 587
   - **Gebruikersnaam / wachtwoord (of API key)**: van je gekozen dienst
   - **Van-adres**: bijv. `noreply@goldpeak.com`
   - **Van-naam**: bijv. "Storechecks"
4. Sla op. Firebase test meestal automatisch de verbinding.

### Stap 4 — Testen

Registreer een nieuw test-account (of gebruik "Wachtwoord vergeten" op een
bestaand account) en controleer of de mail nu wél aankomt — ook zonder in de
spamfolder te hoeven kijken.

## Wat als je dit niet meteen kan regelen?

Tot custom SMTP is ingesteld, kun je nieuwe collega's handmatig verifiëren met
het meegeleverde script `functions/verify-user.js`.

### Eenmalig instellen (per Cloud Shell-sessie / computer)

1. Download een service-account sleutel: **Firebase Console → tandwiel-icoon →
   Project settings → Service accounts → Generate new private key**. Dit
   downloadt een `.json`-bestand.
2. Upload dat bestand naar Cloud Shell (⋮-menu → Upload).
3. Zet het pad ernaartoe als environment variable:
   ```
   export GOOGLE_APPLICATION_CREDENTIALS=~/<naam-van-je-sleutel>.json
   ```

Bewaar dit `.json`-bestand goed en deel het met niemand — het geeft volledige
toegang tot je Firebase-project, ongeacht de rules. Zet het nooit in een (git)
repo of gedeelde map.

### Een gebruiker verifiëren (herhaal dit per nieuwe collega)

```
cd ~/Mapping-main/functions
node verify-user.js iemand@goldpeak.com
```

Je ziet dan `✔ iemand@goldpeak.com is nu geverifieerd.` — die collega kan
daarna gewoon inloggen met e-mail + wachtwoord, zonder de verificatiemail nodig
te hebben.

Kom je terug in een **nieuwe** Cloud Shell-sessie? Dan moet je alleen het
`.json`-sleutelbestand opnieuw uploaden en de `export GOOGLE_APPLICATION_...`
regel opnieuw uitvoeren — het script zelf staat al klaar in de projectmap.
