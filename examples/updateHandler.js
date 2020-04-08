const path = require("path");

// This must be the root directory of your application.
// It should point to the directory where the package.json and your entry point file
// (started with "node main.js") is located.
// Depending on your setup you might have to customize this line.
// If you using TypeScript (or another transpiler to JavaScript) this must be the root
// of your TypeScript code (and the transpiled .js file must be in a subdir called /bundle or the root too).
const APP_DIR = path.dirname(require.main.filename);

// This is the directory where the .tar.gz file is being created when releasing a new version.
// This directory must also contain the
const DEST_DIR = path.join(APP_DIR, '..', 'deploy') + path.sep;

// The URL to check for updates and download the JSON file of the updater.
// This must be the same URL you connect to via FTP in UpdateSettings.js.
// You may use a CDN to download the tar.gz file by overwriting it in the JSON file.
const UPDATE_URL = "https://username:password@domain.com/path/Project.json";
//const UPDATE_URL = "https://simple-domain.com/path/"; // if the URL doesn't end with .json the updater will add {name}.json (name loaded from package.json of your project)

// You can add minimist as dependency so you can use --bundle as app argument to release a new version.
//const argv = require('minimist')(process.argv.slice(2));
const argv = {
    bundle: true // use true to release an update, false in production to download updates
}

const updater = require("@ekliptor/packed-updater");

const logger = console;
// Use your custom logger for the updater (such as winston).
// Defaults to console logger.
updater.setLogger(logger);


/**
 * Run the updater.
 * You can call this once on app startup or periodically.
 * @param callback() an optional callback that will be called if the app is ready (latest version)
 */
export function runUpdater(callback) {
    //if (process.env.IS_CHILD) // consider not running the updater in child processes by adding an environment variable to children
        //return callback && callback() // nothing to do

    if (argv.bundle === true) {
        const settings = require(path.join(DEST_DIR, 'UpdateSettings.js')); // will only exist on dev machines
        let updateOptions = {
            srcPath: APP_DIR,
            bundleDestDir: DEST_DIR,
            enforceModuleVersions: {
                "mkdirp": "^0.5.1" // fix for tar-fs
            },
            uploadSettings: settings.set.uploadSettings,
            ignorePaths: [
                path.join(APP_DIR, 'docs'),
                path.join(APP_DIR, 'temp'),
                // add paths of directories or files you don't want to upload with a new release
            ]
        }
        updater.createBundle(updateOptions, (err, bundle) => {
            if (err)
                logger.error('Error creating update bundle', err)
            else
                logger.log('Created update bundle', bundle)
            process.exit(0)
        })
        return
    }
    //else if (nconf.get('debug') === true || argv.debug === true) // don't update debug environment
        //return callback && callback()

    let updateOptions = {
        srcPath: APP_DIR,
        updateJsonUrl: UPDATE_URL,
        download: true
    }
    updater.checkUpdates(updateOptions, async (err, bundle) => {
        if (err) {
            logger.error('Error checking for updates', err)
            return callback && callback() // continue with current version
        }
        else if (bundle && bundle.newVersion === true) {
            let installOptions = {
                srcPath: APP_DIR,
                bundle: bundle
            }
            updater.installUpdate(installOptions, (err) => {
                if (err)
                    logger.error('Error installing update', err)
                process.exit(1) // this callback won't be reached if the update was installed
            })
        }
        else {
            let name = bundle && bundle.name ? bundle.name : 'unknown'
            logger.info(name + ' version is up to date')
            callback && callback()
        }
    })
}
