"use strict";

const fs = require('fs')
    , crypto = require('crypto')

const helper = module.exports

helper.parseJson = function(json) {
    try {
        return JSON.parse(json)
    } catch (error) {
        // fallback for JSONC files such as tsconfig.json (comments + trailing commas)
        try {
            return JSON.parse(helper.stripJsonComments(json))
        } catch (error) {
            //logger.error('Error parsing JSON: ' + error)
            return null
        }
    }
}

/**
 * Remove a leading BOM, // and /* *\/ comments and trailing commas from a JSON string (JSONC).
 * String contents (including escaped quotes) are left untouched.
 * @param json {string}
 * @returns {string}
 */
helper.stripJsonComments = function(json) {
    if (json.charCodeAt(0) === 0xFEFF)
        json = json.substring(1)
    let out = ''
    let i = 0
    const len = json.length
    while (i < len) {
        const ch = json[i]
        const next = json[i + 1]
        if (ch === '"') {
            // copy the whole string literal
            let end = i + 1
            while (end < len && json[end] !== '"') {
                if (json[end] === '\\')
                    end++
                end++
            }
            out += json.substring(i, end + 1)
            i = end + 1
        }
        else if (ch === '/' && next === '/') {
            while (i < len && json[i] !== '\n' && json[i] !== '\r')
                i++
        }
        else if (ch === '/' && next === '*') {
            const end = json.indexOf('*/', i + 2)
            i = end === -1 ? len : end + 2
        }
        else if (ch === ',') {
            // drop trailing commas before a closing bracket/brace
            let j = i + 1
            while (j < len && /\s/.test(json[j]))
                j++
            if (json[j] !== '}' && json[j] !== ']')
                out += ch
            i++
        }
        else {
            out += ch
            i++
        }
    }
    return out
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

/**
 * promiseDelay returns a promise that gets resolved after the specified time
 */
helper.promiseDelay = function(delayMs, value = null) {
    return new Promise((resolve, reject)=>{
        setTimeout(() => {
            resolve(value);
        }, delayMs);
    })
}
