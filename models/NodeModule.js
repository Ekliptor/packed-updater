const path = require("path")

class NodeModule {
    constructor(modulePath, packageJson, tsconfig) {
        this.modulePath = modulePath;
        this.packageJson = packageJson;
        this.tsconfig = tsconfig;
    }

    getBasename() {
        //return path.sep + path.basename(this.modulePath) + path.sep
        return path.sep + NodeModule.getBaseFromPath(this.modulePath) + path.sep
    }

    getBuildDir() {
        if (!this.tsconfig || !this.tsconfig.compilerOptions || !this.tsconfig.compilerOptions.outDir)
            return "./"
        return this.tsconfig.compilerOptions.outDir
    }

    static getBaseFromPath(moduleName) {
        let base = path.basename(moduleName)
        let scopeStart = moduleName.lastIndexOf("@");
        if (scopeStart !== -1)
            base = moduleName.substr(scopeStart)
        return base
    }
}
module.exports = NodeModule
