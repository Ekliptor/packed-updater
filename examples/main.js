// This is the entry point of your app in your application's root directory.
// It is the file you run with: node main.js

const updateHandler = require("./updateHandler");

updateHandler.runUpdater(() => { // will restart the app (install latest version) or fire this callback
    // See updateHandler.js for more options. You can also just check for updates without installing them.

    // we are running the latest version. Continue with your app startup here...
});
