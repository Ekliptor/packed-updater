// Type definitions for @ekliptor/packed-updater
// The main module does `module.exports = new Updater()`, so the public API is a
// single Updater instance. All async methods use Node-style error-first callbacks
// (they do NOT return Promises). Types derived from JSDoc in updater.js.

declare const updater: updater.Updater;
export = updater;

declare namespace updater {
    type UpdaterError = Error | { text: string };

    /** A console-style logger. The global `console` satisfies this. */
    interface Logger {
        log(...args: any[]): void;
        error(...args: any[]): void;
        warn(...args: any[]): void;
        info(...args: any[]): void;
        [member: string]: any;
    }

    interface UploadSettings {
        ftpDestDir: string;
        host: string;
        port?: number;
        username?: string;
        user?: string;
        password?: string;
        type?: "ftp" | "sftp";
        privateKey?: string;
        secure?: boolean;
        secureOptions?: object;
        verbose?: boolean;
        maxRetries?: number;
        retryDelayMs?: number;
    }

    interface CreateBundleOptions {
        /** Root dir of your app (must contain package.json). */
        srcPath: string;
        /** Where to place the .tar.gz (must be outside srcPath). */
        bundleDestDir: string;
        /** Add .js.map files to the bundle. Default true. */
        addSourceMaps?: boolean;
        /** FTP/SFTP upload settings. If omitted the bundle is only created locally. */
        uploadSettings?: UploadSettings;
        /** Bundle devDependencies from the root package.json. Default false. */
        bundleDevDependencies?: boolean;
        /** Pin npm dependencies to specific versions. */
        enforceModuleVersions?: Record<string, string>;
        /** Append the version number to the archive name. Default false. */
        addVersion?: boolean;
        /** Paths to exclude from the bundle. */
        ignorePaths?: string[];
        /** Ensure local workspace modules are installed before bundling. Default true. (Spelling matches the implementation.) */
        ensureWorspaceModulesInstalled?: boolean;
        /** Bundle .ts source files directly instead of compiled .js. Default false. */
        bundleTypescript?: boolean;
    }

    /** Object passed to the createBundle callback on success. */
    interface CreatedBundle {
        /** Path to the created .tar.gz archive. */
        dest: string;
        /** Path to the created metadata .json (updater.json) file. */
        jsonDest: string;
        /** True when uploadSettings were provided and the upload succeeded. */
        uploaded?: boolean;
    }

    interface CheckUpdatesOptions {
        /** Root dir of your app. Defaults to process.cwd(). */
        srcPath?: string;
        /** URL of the remote updater JSON. If it doesn't end in ".json", "{name}.json" is appended. */
        updateJsonUrl: string;
        /** Download and SHA1-verify the bundle locally. Default false. */
        download?: boolean;
    }

    /** Contents of the remote updater.json plus fields added by checkUpdates(). */
    interface UpdaterBundle {
        name: string;
        version: string;
        archiveName: string;
        sha1: string;
        /** ISO date string. */
        created: string;
        bundleUrl: string;
        /** True if the remote bundle hash differs from the local one. Always set by checkUpdates(). */
        newVersion: boolean;
        /** Local path of the downloaded bundle. Only set when download:true succeeded. */
        dest?: string;
    }

    interface InstallUpdateOptions {
        /** The bundle obtained from checkUpdates() (must contain `dest`). */
        bundle: UpdaterBundle;
        /** Root dir of your app. Defaults to process.cwd(). */
        srcPath?: string;
        /** Use yarn. Default: auto-detect. */
        yarn?: boolean;
        /** Use pnpm. Default: auto-detect. */
        pnpm?: boolean;
        /** Exit the process after updating instead of restarting. Default false. */
        exitAfterUpdate?: boolean;
        /** Install devDependencies. Default false. */
        installDevDependencies?: boolean;
        /** TODO, not implemented. */
        liveUpdate?: boolean;
        /** TODO, not implemented. */
        removeAllExistingFiles?: boolean;
        /** Directories to remove (e.g. build dirs). Default []. */
        removeDirs?: string[];
        /** Remove old bundles from the OS temp dir. Default true. */
        removeOldBundles?: boolean;
    }

    interface Updater {
        /** Replace the default `console` logger with a console-style object. */
        setLogger(loggerObj: Logger): void;

        /** Create a .tar.gz bundle of your app (optionally uploading it). Result via callback. */
        createBundle(
            options: CreateBundleOptions,
            callback: (err: UpdaterError | null, bundle?: CreatedBundle) => void,
        ): void;

        /** Check the remote updater JSON for a new version (optionally downloading it). */
        checkUpdates(
            options: CheckUpdatesOptions,
            callback: (err: UpdaterError | null, bundle?: UpdaterBundle) => void,
        ): void;

        /**
         * Install a previously downloaded update. On success the app restarts and the
         * callback is NOT called; the callback fires on error.
         */
        installUpdate(
            options: InstallUpdateOptions,
            callback: (err: UpdaterError | null, result?: number) => void,
        ): void;
    }
}
