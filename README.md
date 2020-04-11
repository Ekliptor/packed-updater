# packed-updater
An auto updater for your NodeJS apps.

This works for Express.js web servers, command line apps and more.

## Update process
After adding this module to your app, these are the steps it will do for you:
1. **Create update bundles**: Create a `.tar.gz` bundle of your node application including all resources (images, translations,...) and excluding dependencies installed in `node_modules`.
The bundle will include all your private `node_modules` as specified in their `package.json`. 
2. **Upload bundles**: Upload the `.tar.gz` bundle along with a metadata JSON file via FTP/SFTP to a server.
3. **Check for updates**: Check the JSON file uploaded in step 2 for updates.
4. **Download the update**: If an update is available the `.tar.gz` bundle will be downloaded (to your operating system's temp directory) and its SHA1 hash verified.
5. **Install he update**: Fork a child process, exit the parent process (using `process.exit(0)`) and add/overwrite all files from the `.tar.gz` bundle. Config options to keep existing application files (default) or remove the old application directory completely are available.
6. **Restart the app**: After the update the child process will restart the main process with the same environment variables and command line arguments so your application can resume. Finally the child process terminates.

Ideally, steps 2-6 are done continuously while your app is running.

This module can bundle apps consisting of many local modules using [Yarn Workspaces](https://classic.yarnpkg.com/en/docs/workspaces/) into a single `.tar.gz` file. It also works with TypeScript projects.

## Getting Started

### Requirements
```
NodeJS >= 10
yarn >= 1.9.4 (or npm >= 5.0)
HTTP server (to serve static files) with an FTP/SFTP account
```
Yarn (or NPM) must be installed on all machines because this updater will use it to update dependencies of your app.

### Installation
```
yarn add @ekliptor/packed-updater
```
or:
```
npm install @ekliptor/packed-updater
```


## Docs
Take a look at [code examples](https://github.com/Ekliptor/packed-updater/tree/master/examples).

#### Updater class
##### createBundle(options, callback) 
Creates a `.tar.gz` bundle archive of your app.
This function will only bundle modules where in `package.json`:
private: true or
bundleUpdate: true or
privateNoInstall: true (means their dependencies will not be bundled recursively)

Options:
* `string srcPath` - Path to the root directory of your app (must have a package.json file).
* `string bundleDestDir` - Path where to place the .tar.gz file for upload.
* `boolean addSourceMaps` - (optional, default true) - Add `.js.map` files to the bundle.
* `object uploadSettings` - FTP upload settings to distribute releases. See `/deploy/UpdateSettings.js` for an example.
* `boolean bundleDevDependencies` - (optional, default false) Bundle private developer dependencies (specified in your root `package.json`) in the `.tar.gz` file.
* `object enforceModuleVersions` - (optional) Pin NPM dependencies to a specific version. Use this in case there are inompatibilities of different modules requiring the same dependency. Try to resolve it in `yarn.lock` file first.
* `boolean addVersion` - (optional, default false) Try to resolve it in yarn.lock file first.
* `string[] ignorePaths` - (optional)  Some paths with app data you don't want to release in the .tar.gz bundle (such as user data).
* `boolean ensureWorspaceModulesInstalled` - Ensure all modules of our local workspaces are installed before shipping the update. When using yarn workspaces this is a safety check to ensure your app is starting before shipping the update.

Callback:
* `object err` - The error (if any).
* `object bundle` - The created bundle.

##### checkUpdates(options, callback)
Checks for updates of your app.
It will detect new versions based on the hash of the bundle (IGNORES the version number).

Options:
* `string srcPath` - (optional) Path to the root directory of your app (should contain the latest updater.json file created by this updater or else will assume the update is new). If not set, it will assume the current working directory.
* `string updateJsonUrl` - The URL of the latest JSON file. If it doesn't end with `.json`, then `{name}.json` will be appended with the name from `package.json`.
* `boolean download` - Download & verify the update in a local directory. If false it will just check for a new version and fire the callback with details.

Callback:
* `object err` - The error (if any).
* `object bundle` - bundle will hold the contents of the remote updater.json file with additional properties:
    * `boolean newVersion` - If the version on the web is a new version.
    * `string dest` - The local path of the downloaded bundle (if download == true).

##### installUpdate(options, callback) 
Installs a previously downloaded update (downloaded by calling `checkUpdates()`).

It will:
1. start the updater process
2. close the app
3. extract the bundle
4. run npm/yarn install
5. start the latest version app

The callback will only be called on error. Otherwise the app will be restarted WITHOUT calling this.
You should cleanup your open sockets etc before calling this function to allow the app to shutdown gracefully.

Options:
* `boolean yarn` - (optional) Use yarn instead of npm. `default = auto detect = true` (if yarn is installed).
* `string srcPath` - (optional) Path to the root directory of your app. If not supplied `process.cwd()` will be used.
* `object bundle` - The update previously downloaded with `checkUpdates()`.
* `boolean exitAfterUpdate` - (optional, default false) Exit the node process after the update instead of restarting it.
* `boolean installDevDependencies` - (optional, default false) See `bundleDevDependencies()` for details.
* `string[] removeDirs` - (optional, default none `[]`) Remove directories before restarting the app.
* `boolean removeOldBundles` - (optional, default true) Remove old updater bundles from OS temp directory.

Callback:
* `object err` - The error if the installation failed. On success the app will restart.

##### setLogger(logger)
Use your custom logger (winston, ...) object. If not called, `console` logger will be used.
* `object logger` - Your custom logger object implementing the same log functions as `console`.

---

## ToDos
* installing new apps doesn't work on Windows Servers due to permission issues (releasing updates works)

## Contact
Follow me on [Twitter](https://twitter.com/ekliptor) and [Memo](https://memo.cash/profile/1JFKA1CabVyX98qPRAUQBL9NhoTnXZr5Zm).
