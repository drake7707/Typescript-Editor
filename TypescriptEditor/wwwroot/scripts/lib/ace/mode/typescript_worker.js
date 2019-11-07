/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2010, Ajax.org B.V.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of Ajax.org B.V. nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL AJAX.ORG B.V. BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

define(function (require, exports, module) {
    "no use strict";

    var oop = require("../lib/oop");
    var Mirror = require("../worker/mirror").Mirror;
    var lang = require("../lib/lang");
    var Document = require("../document").Document;
    var DocumentPositionUtil = require('./typescript/DocumentPositionUtil').DocumentPositionUtil;

    var ts = require('./typescript/typescriptServices');
    var TypeScriptLS = require('./typescript/lightHarness').TypeScriptLS;

    var TypeScriptWorker = exports.TypeScriptWorker = function (sender) {
        Mirror.call(this, sender);
        this.setTimeout(500);

        this.sender = sender;

        var deferredUpdate = this.deferredUpdate = lang.deferredCall(this.onUpdate.bind(this));

        this.ts = ts;
        this.typeScriptLS = new TypeScriptLS();
        this.languageService = this.ts.createLanguageService(this.typeScriptLS, ts.createDocumentRegistry());

        var self = this;
        //sender.on("change", function (e) {
        //    //doc.applyDeltas(e.data);
        //    deferredUpdate.schedule(self.$timeout);
        //});

        sender.on("addLibrary", function (e) {
            self.addlibrary(e.data.name, e.data.content);
        });

        sender.on("setCompilerOptions", function (e) {
            var options = JSON.parse(e.data.compilerOptions);
            self.setCompilerOptions(options);
        });


        this.setOptions();
        sender.emit("initAfter");
    };

    oop.inherits(TypeScriptWorker, Mirror);

    (function () {
        var proto = this;
        this.setOptions = function (options) {
            this.options = options || {
            };
        };
        this.changeOptions = function (newOptions) {
            oop.mixin(this.options, newOptions);
            this.deferredUpdate.schedule(100);
        };

        this.addlibrary = function (name, content) {
            this.typeScriptLS.addScript(name, content.replace(/\r\n?/g, "\n"), true);
        };

        this.setCompilerOptions = function (compilerOptions) {
            this.typeScriptLS.setCompilerOptions(compilerOptions);
            this.onUpdate();
        };

        this.getCompletionsAtPosition = function (fileName, pos, isMemberCompletion, id) {
            var ret = this.languageService.getCompletionsAtPosition(fileName, pos, isMemberCompletion);
            this.sender.callback(ret, id);
        };

        this.compile = function (typeScriptContent) {
            var output = "";
            var sourceMap = "";

            var program = ts.createProgram(["temp.ts"], this.typeScriptLS.getCompilationSettings(), this.typeScriptLS);
            var typeChecker = program.getTypeChecker(true);
            var emitResult = program.emit(program.getSourceFile("temp.ts"), function (fileName, data, writeByteOrderMark, onError) {
                if (fileName == "temp.js") {
                    output += data;
                }
            });


            for (var i = 0; i < emitResult.sourceMaps.length; i++) {
                if (emitResult.sourceMaps[i].inputSourceFileNames.indexOf("temp.ts") >= 0) {

                    var sourceMapObj = {
                        file: emitResult.sourceMaps[i].inputSourceFileNames,
                        version: 1,
                        mappings: emitResult.sourceMaps[i].sourceMap.mappings,
                        names: emitResult.sourceMaps[i].sourceMap.names,
                        sourceRoot: emitResult.sourceMaps[i].sourceMap.sourceRoot,
                        sources: emitResult.sourceMaps[i].sourceMap.sources
                    };
                    sourceMap = JSON.stringify(sourceMapObj);
                    break;
                }
            }

            return {
                javascript: output,
                mapping: sourceMap
            };
        };

        this.onUpdate = function () {
            this.typeScriptLS.updateScript("temp.ts", this.doc.getValue(), false);

            var outputFile = this.languageService.getEmitOutput("temp.ts");
            var errors = this.languageService.getCompilerOptionsDiagnostics()
                .concat(this.languageService.getSyntacticDiagnostics("temp.ts"))
                .concat(this.languageService.getSemanticDiagnostics("temp.ts"));

            var annotations = [];
            var self = this;
            this.sender.emit("compiled", this.compile(this.doc.getValue()));

            errors.forEach(function (error) {
                var pos = DocumentPositionUtil.getPosition(self.doc, error.start);

                var hasCodeFixesAvailable = false;
                try {
                    var formatSettings = self.typeScriptLS.getFormatCodeSettings();
                    var codefixes = self.languageService.getCodeFixesAtPosition("temp.ts", error.start, error.start + error.length, [error.code], formatSettings);
                    hasCodeFixesAvailable = codefixes.length > 0;
                }
                catch (err) {
                    console.warn("Unable to fetch code fixes");
                    console.error(err);
                }
                annotations.push({
                    row: pos.row,
                    column: pos.column,
                    text: typeof error.messageText === "string" ? error.messageText : error.messageText.messageText, // work around a bug in typescript i think
                    minChar: error.start,
                    limChar: error.start + error.length,
                    code: error.code,
                    type: hasCodeFixesAvailable ? "errorfix" : "error",
                    raw: typeof error.messageText === "string" ? error.messageText : error.messageText.messageText
                });


            });

            this.sender.emit("compileErrors", annotations);
        };

    }).call(TypeScriptWorker.prototype);

});
