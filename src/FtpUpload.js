const ftp = require('basic-ftp')
    , path = require('path')

let logger = console

class FtpUpload {
    constructor(settings) {
        this.ftp = new ftp.Client()
        this.ftp.ftp.verbose = settings.verbose || false
        this.settings = settings
        this.maxRetries = settings.maxRetries || 3
        this.retryDelayMs = settings.retryDelayMs || 2000
        this.verifyFtpSettings();
    }

    static setLogger(loggerObj) {
        logger = loggerObj
    }

    uploadBundle(bundle) {
        return new Promise((resolve, reject) => {
            logger.log('Updater: Connecting via FTP...')
            this.connect().then(() => {
                return this.createUploadDir()
            }).then(() => {
                logger.log('Updater: Uploading bundle...')
                return this.upload(bundle)
            }).then(() => {
                logger.log('Updater: Uploaded bundle')
                bundle.uploaded = true
                resolve()
                return this.disconnect();
            }).catch((err) => {
                this.disconnect()
                reject(err)
            })
        })
    }

    // ################################################################
    // ###################### PRIVATE FUNCTIONS #######################

    async connect() {
        await this.ftp.access({
            host: this.settings.host,
            port: this.settings.port || 21,
            user: this.settings.user || this.settings.username,
            password: this.settings.password,
            secure: this.settings.secure || false,
            secureOptions: this.settings.secureOptions || null
        })
    }

    disconnect() {
        this.ftp.close();
    }

    async createUploadDir() {
        await this.ftp.ensureDir(this.settings.ftpDestDir)
    }

    async upload(bundle) {
        const bundleName = path.basename(bundle.dest)
        let remoteDest = this.settings.ftpDestDir
        if (remoteDest.substr(-1) !== "/")
            remoteDest += "/"
        remoteDest += bundleName

        await this.uploadWithRetry(bundle.dest, remoteDest)

        const jsonName = path.basename(bundle.jsonDest)
        const jsonRemoteDest = this.settings.ftpDestDir + '/' + jsonName

        await this.uploadWithRetry(bundle.jsonDest, jsonRemoteDest)
    }

    async uploadWithRetry(localPath, remotePath) {
        let lastError = null
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                await this.ftp.uploadFrom(localPath, remotePath)
                return
            }
            catch (err) {
                lastError = err
                logger.warn(`FTP upload attempt ${attempt}/${this.maxRetries} failed: ${err.message}`)
                if (attempt < this.maxRetries) {
                    const delay = this.retryDelayMs * attempt // exponential backoff
                    logger.log(`Retrying in ${delay}ms...`)
                    await this.sleep(delay)
                    // Reconnect in case connection was dropped
                    try {
                        await this.connect()
                    }
                    catch (reconnectErr) {
                        logger.warn(`Reconnect failed: ${reconnectErr.message}`)
                    }
                }
            }
        }
        throw lastError
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    verifyFtpSettings() {
        if (!this.settings || typeof this.settings !== "object")
            throw new Error("'uploadSettings' must be a valid object");
        if (!this.settings.ftpDestDir || typeof this.settings.ftpDestDir !== "string")
            throw new Error("'uploadSettings.ftpDestDir' must be a directory path to upload");
        if (!this.settings.host || typeof this.settings.host !== "string")
            throw new Error("'uploadSettings.host' must be a valid hostname");
    }
}

module.exports = FtpUpload