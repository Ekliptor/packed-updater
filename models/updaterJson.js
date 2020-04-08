
const updaterJson = module.exports

class UpdaterJsonData {
    constructor(name, version, archiveName, sha1) {
        this.name = name
        this.version = version
        this.archiveName = archiveName
        this.sha1 = sha1
        this.created = new Date().toISOString()
        this.bundleUrl = ''                         // the url where the bundle is located. Use a relative path to download it from same server path ("MyApp.tar.gz")

        // set on update
        //this.newVersion = false
        //this.dest = ''

        // set on install
        //this.installed = null
    }
}
updaterJson.UpdaterJson = UpdaterJsonData