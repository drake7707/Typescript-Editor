define(["require", "exports", './EditorPosition'], function (require, exports, __EditorPositionModule__) {
    var EditorPositionModule = __EditorPositionModule__;

    var CompilationService = (function () {
        function CompilationService(editor, languageService) {
            this.editor = editor;
            this.languageService = languageService;
            this.editorPos = new EditorPositionModule.EditorPosition(editor);
        }
        CompilationService.prototype.getCompilation = function (script, charpos, isMemberCompletion, limit) {
            var compInfo;
            compInfo = this.languageService.getCompletionsAtPosition(script + ".ts", charpos, isMemberCompletion);
            if (typeof compInfo !== "undefined") {
                if (typeof limit !== "undefined")
                    compInfo.entries = compInfo.entries.slice(0, limit);
            }
            return compInfo;
        };

        CompilationService.prototype.getCompilationDetails = function (script, cursor, name) {
            var pos = this.editorPos.getPositionChars(cursor);
            return this.languageService.getCompletionEntryDetails(script + ".ts", pos, name);
        };

        CompilationService.prototype.isMemberCompletion = function (script, cursor, limit) {
            var matches, pos, text;
            pos = this.editorPos.getPositionChars(cursor);
            text = this.editor.session.getLine(cursor.row).slice(0, cursor.column);
            matches = text.match(/\.([a-zA-Z_0-9\$]*$)/);
            if (matches && matches.length > 0) {
                return true;
            } else {
                return false;
            }
            
        };

        CompilationService.prototype.getCursorCompilation = function (script, cursor, limit) {
            var isMemberCompletion, matches, pos, text;
            pos = this.editorPos.getPositionChars(cursor);
            text = this.editor.session.getLine(cursor.row).slice(0, cursor.column);
            isMemberCompletion = false;
            matches = text.match(/\.([a-zA-Z_0-9\$]*$)/);
            if (matches && matches.length > 0) {
                this.matchText = matches[1];
                isMemberCompletion = true;
                pos -= this.matchText.length;
            } else {
                matches = text.match(/[a-zA-Z_0-9\$]*$/);
                this.matchText = matches[0];
            }
            return this.getCompilation(script, pos, isMemberCompletion, limit);
        };
        CompilationService.prototype.getCurrentPositionCompilation = function (script, limit) {
            return this.getCursorCompilation(script, this.editor.getCursorPosition(), limit);
        };
        return CompilationService;
    })();
    exports.CompilationService = CompilationService;
})
