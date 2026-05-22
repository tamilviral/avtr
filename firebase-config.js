const firebaseConfig = {
    apiKey: "AIzaSyDoB1TQlsd9EcOM0xx-LyyPDSCBbxDmMfc",
    authDomain: "avtr-899ee.firebaseapp.com",
    databaseURL: "https://avtr-899ee-default-rtdb.firebaseio.com",
    projectId: "avtr-899ee",
    storageBucket: "avtr-899ee.firebasestorage.app",
    messagingSenderId: "590268537916",
    appId: "1:590268537916:web:1b10ec1e1f5da3fe467739"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
