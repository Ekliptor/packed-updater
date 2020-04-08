# packed-updater
An auto updater for your NodeJS apps.

This works for Express.js web servers, command line apps and more.

## Update process
After adding this module to your app, these are the steps it will do for you:
1. **Create update bundles**: Create a `.tar.gz` bundle of your node application including all resources (images, translations,...) and excluding dependencies installed in `node_modules`.
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
Take a look at [code examples](https://todo).

#### Updater class
##### createBundle(options, callback) 
Creates a .tar.gz bundle archive of your app.

Options:
* `string srcPath` - Path to the root directory of your app (must have a package.json file).
* `string bundleDestDir` - Path where to place the .tar.gz file for upload.
* `boolean addSourceMaps` - (optional, default true) - Add `.js.map` files to the bundle.
* `object uploadSettings` - 
* `boolean bundleDevDependencies` - 
* `object enforceModuleVersions` - 
* `boolean addVersion` - 
* `string[] ignorePaths` - 
* `object bundleDevDependencies` - 
* `boolean ensureWorspaceModulesInstalled` - 

##### checkUpdates(options, callback)
Checks for updates of your app.

Options:
* `boolean addVersion` - 

##### installUpdate(options, callback) 
Installs a previously downloaded update.

Options:
* `boolean addVersion` - 

##### setLogger(logger)
Use your custom logger (winston, ...) object. If not called, `console` logger will be used.
* `object logger` - Your custom logger object implementing the same log functions as `console`.

---

## ToDos
* installing new apps doesn't work on Windows Servers due to permission issues (releasing updates works)

## Contact
Follow me on [Twitter](https://twitter.com/ekliptor) and [Memo](https://memo.cash/profile/1JFKA1CabVyX98qPRAUQBL9NhoTnXZr5Zm).
