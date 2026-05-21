const firebaseConfig = {
    apiKey: "AIzaSyAamiz5i_njeSZ9LaAXedxtMMlDVm2Mw0w",
    authDomain: "avtr-7a851.firebaseapp.com",
    projectId: "avtr-7a851",
    storageBucket: "avtr-7a851.firebasestorage.app",
    messagingSenderId: "216465267194",
    appId: "1:216465267194:web:15b44acd48242b71bb6c43"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
