"use strict";

const fs = require('fs')
    , crypto = require('crypto')

const helper = module.exports

helper.parseJson = function(json) {
    try {
        return JSON.parse(json)
    } catch (error) {
        //logger.error('Error parsing JSON: ' + error)
        return null
    }
}

helper.escapeRegex = function(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')
}

helper.substrCount = function(str, find) {
    let regex = helper.escapeRegex(find)
    let count = (str.match(new RegExp(regex, 'g')) || []).length
    return count
}

helper.getRandomString = function(len) {
    let chars = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    let random = ''
    for (let i = 0; i < len; i++)
        random += chars.charAt(Math.floor(Math.random() * chars.length))
    return random
}

helper.getWebDir = function(url) {
    let stop = url.lastIndexOf('/')
    if (stop === -1)
        return url + '/' // root domain
    return url.substr(0, stop+1)
}

helper.hashFile = function(src, algo = 'sha1') {
    return new Promise((resolve, reject) => {
        let fd = fs.createReadStream(src)
        let hash = crypto.createHash(algo)
        fd.on('end', () => {
            hash.end()
            let data = hash.read()
            resolve(data ? data.toString('hex') : '')
        })
        fd.pipe(hash)
    })
}

helper.escapeRegex = function (str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')
}

helper.substrCount = function(str, find) {
    let regex = helper.escapeRegex(find)
    let count = (str.match(new RegExp(regex, 'g')) || []).length
    return count
}

helper.getFileSizeBytes = async function(location, options = {}) {
    try {
        let stats = await fs.promises.stat(location, options)
        return stats.size
    }
    catch (err) {
        return 0;
    }
}
