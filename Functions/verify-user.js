// Handmatig een gebruiker verifiëren, zonder op de (mogelijk geblokkeerde)
// verificatiemail te wachten.
//
// Gebruik (vanuit de functions-map, met GOOGLE_APPLICATION_CREDENTIALS gezet):
//   node verify-user.js iemand@goldpeak.com
//
// Zie EMAIL-VERIFICATIE.md in de projectroot voor de volledige uitleg
// (inclusief hoe je de service-account sleutel en GOOGLE_APPLICATION_CREDENTIALS
// instelt).

const admin = require("firebase-admin");

const email = process.argv[2];

if (!email) {
  console.error("Gebruik: node verify-user.js <e-mailadres>");
  process.exit(1);
}

admin.initializeApp();

admin
  .auth()
  .getUserByEmail(email)
  .then((user) => admin.auth().updateUser(user.uid, { emailVerified: true }))
  .then(() => {
    console.log(`✔ ${email} is nu geverifieerd.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`✘ Mislukt voor ${email}:`, error.message);
    process.exit(1);
  });
