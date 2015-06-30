/// This is an extract of harness.js .
///   Just the ScriptInfo and the
///  TypeScriptLS classes.
/// Notice the manual require calls for ./typescriptServices.
define(function (require, exports, module) {

    var __extends = this.__extends || function (d, b) {
        function __() {
            this.constructor = d;
        }
        __.prototype = b.prototype;
        d.prototype = new __();
    };

    var ts = require('./typescriptServices');

    var ScriptInfo = (function () {
        function ScriptInfo(name, content, isResident, maxScriptVersions) {
            this.name = name;
            this.content = content;
            this.isResident = isResident;
            this.maxScriptVersions = maxScriptVersions;
            this.editRanges = [];
            this.version = 1;
        }
        ScriptInfo.prototype.updateContent = function (content, isResident) {
            this.editRanges = [];
            this.content = content.replace(/\r\n?/g, "\n");
            this.isResident = isResident;
            this.version++;
        };

        ScriptInfo.prototype.editContent = function (minChar, limChar, newText) {
            var prefix = this.content.substring(0, minChar);
            var middle = newText;
            var suffix = this.content.substring(limChar);
            this.content = prefix + middle + suffix;
            this.version++;
        };

        return ScriptInfo;
    })();
    exports.ScriptInfo = ScriptInfo;
    var TypeScriptLS = (function () {
        function TypeScriptLS() {
            this.ls = null;
            this.scripts = [];
            this.maxScriptVersions = 100;
        }

        TypeScriptLS.prototype.addFile = function (name, isResident) {
            if (typeof isResident === "undefined") { isResident = false; }
            var code = Harness.CollateralReader.read(name);
            this.addScript(name, code, isResident);
        };
        TypeScriptLS.prototype.addScript = function (name, content, isResident) {
            if (typeof isResident === "undefined") { isResident = false; }
            var script = new ScriptInfo(name, content, isResident, this.maxScriptVersions);
            this.scripts.push(script);
        };
        TypeScriptLS.prototype.updateScript = function (name, content, isResident) {
            if (typeof isResident === "undefined") { isResident = false; }
            for (var i = 0; i < this.scripts.length; i++) {
                if (this.scripts[i].name == name) {
                    this.scripts[i].updateContent(content, isResident);
                    return;
                }
            }
            this.addScript(name, content, isResident);
        };
        TypeScriptLS.prototype.editScript = function (name, minChar, limChar, newText) {
            for (var i = 0; i < this.scripts.length; i++) {
                if (this.scripts[i].name == name) {
                    this.scripts[i].editContent(minChar, limChar, newText);
                    return;
                }
            }
            throw new Error("No script with name '" + name + "'");
        };

        TypeScriptLS.prototype.getScriptFileNames = function () {
            var names = [];
            for (var i = 0; i < this.scripts.length; i++) {
                names.push(this.scripts[i].name);
            }
            return names;
        };

        function resolveExternalReference(url) {
            var request = new XMLHttpRequest();
            request.open('GET', url, false);
            request.send(null);

            if (request.status === 200) {
                return request.responseText;
            }
            else
                return null;

            return strReturn;
        }
        TypeScriptLS.prototype.getScriptSnapshot = function (name) {
            for (var i = 0; i < this.scripts.length; i++) {
                if (this.scripts[i].name == name) {
                    return ts.ScriptSnapshot.fromString(this.scripts[i].content);
                }
            }

            if (name.substr(0, 7) == "http://" || name.substr(0, 8) == "https://") {
                var content = resolveExternalReference(name);
                this.addScript(name, content, false);
            }

            for (var i = 0; i < this.scripts.length; i++) {
                if (this.scripts[i].name == name) {
                    return ts.ScriptSnapshot.fromString(this.scripts[i].content);
                }
            }

            return null;
        };

        TypeScriptLS.prototype.getScriptVersion = function (name) {
            for (var i = 0; i < this.scripts.length; i++) {
                if (this.scripts[i].name == name) {
                    return this.scripts[i].version;
                }
            }
        };


        TypeScriptLS.prototype.getCurrentDirectory = function () {
            return "";
        };

        TypeScriptLS.prototype.useCaseSensitiveFileNames = function () {
            return true;
        };
        
        TypeScriptLS.prototype.getScriptIsOpen = function () {
            return true;
        };
        TypeScriptLS.prototype.getDefaultLibFileName = function (options) {
            return "lib";
        };



        TypeScriptLS.prototype.getCanonicalFileName = function (filename) {
            return filename;
        };

        TypeScriptLS.prototype.getCancellationToken = function () {
            return null;
        };

        TypeScriptLS.prototype.getLocalizedDiagnosticMessages = function () {
            return null;
        };

        TypeScriptLS.prototype.getSourceFile = function (filename, languageVersion, onError) {
            var script = null;
            for (var i = 0; i < this.scripts.length; i++) {
                if (this.scripts[i].name == filename) {
                    script = this.scripts[i];
                    break;
                }
            }
            if (script == null)
                return null;

            var sourceFile = ts.createLanguageServiceSourceFile(filename, ts.ScriptSnapshot.fromString(script.content), ts.ScriptTarget.ES5, script.version, true, false);
            return sourceFile;
        }

        TypeScriptLS.prototype.getNewLine = function (scriptIndex) {
            return "\n";
        };


        TypeScriptLS.prototype.getScriptContent = function (scriptIndex) {
            return this.scripts[scriptIndex].content;
        };

        TypeScriptLS.prototype.information = function () {
            return true;
        };
        TypeScriptLS.prototype.debug = function () {
            return true;
        };
        TypeScriptLS.prototype.warning = function () {
            return true;
        };
        TypeScriptLS.prototype.error = function () {
            return true;
        };
        TypeScriptLS.prototype.fatal = function () {
            return true;
        };
        TypeScriptLS.prototype.log = function (s) {

        };

        TypeScriptLS.prototype.getCompilationSettings = function () {
            var settings = ts.getDefaultCompilerOptions();
            settings.sourceMap = true;
            return settings;
        };

        return TypeScriptLS;
    })();
    exports.TypeScriptLS = TypeScriptLS;

});