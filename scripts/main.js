define(function (require, exports, module) {
    var ace = require('ace/ace');
    var AceRange = require('ace/range').Range;
    var AutoComplete = require('AutoComplete').AutoComplete;
    var lang = require("ace/lib/lang");
    var EditorPosition = require('EditorPosition').EditorPosition;
    var CompilationService = require('CompilationService').CompilationService;
    var FileService = require('FileService').FileService;
    var deferredCall = require("ace/lib/lang").deferredCall;

    var vlq = require("lib/vlq");

    var ts = require('ace/mode/typescript/typescriptServices');
    var Services = require('ace/mode/typescript/typescriptServices').Services;
    var TypeScript = require('ace/mode/typescript/typescriptServices').TypeScript;
    var TypeScriptLS = require('ace/mode/typescript/lightHarness').TypeScriptLS;

    var aceEditorPosition = null;
    var appFileService = null;
    var editor = null;
    var editorJavascript = null;
    var editorHTML = null;

    var editorCSS = null;

    var typeCompilationService = null;
    var docUpdateCount = 0;
    var typeScriptLS = new TypeScriptLS();

    var languageService = ts.createLanguageService(typeScriptLS, ts.createDocumentRegistry());

    var selectFileName = "";
    var selectMilestone = "";

    var syncStop = false; //for stop sync on loadfile
    var autoComplete = null;
    var refMarkers = [];
    var errorMarkers = [];
    var runtimeErrorMarkers = [];

    var javascriptSourceMap = null; // the built source map between typescript and javascript, updated when compiled
    var lineNumberOffsetOnPage = 0; // the offset of where the javascript is injected into the html document, chrome reports the correct line number of the script, firefox reports the page number of an error

    function loadTypeScriptLibrary() {
        var libnames = [
            "typescripts/lib.d.ts",
            "typescripts/jquery.d.ts"
        ];

        // Add a non network script to get the balls rolling more quickly
        // See https://typescript.codeplex.com/workitem/129
        var iArgs = "interface IArguments {           [index: number]: any;        length: number;        callee: Function;    }";
        typeScriptLS.addScript('start.d.ts', iArgs, true);

        libnames.forEach(function (libname) {
            appFileService.readFile(libname, function (content) {
                typeScriptLS.addScript(libname, content.replace(/\r\n?/g, "\n"), true);
            });
        });
    }

    function updateHeader(filename, milestone, description) {
        $("#lblFilename").text("- " + filename + " (v" + milestone + ")");
        $("#txtHeaderDescription").text(description);
        $("#txtDescription").val(description);
    }

    function loadInEditors(filename, milestone, html, css, typescript, description) {
        selectFileName = filename;
        selectMilestone = milestone;

        updateHeader(filename, milestone, description);

        editorHTML.setValue(html);
        editorHTML.moveCursorTo(0, 0);

        editorCSS.setValue(css);
        editorCSS.moveCursorTo(0, 0);

        syncStop = true;
        var data = typescript.replace(/\r\n?/g, "\n");
        editor.setValue(data);
        editor.moveCursorTo(0, 0);
        typeScriptLS.updateScript(filename + ".ts", editor.getSession().getDocument().getValue(), false);
        syncStop = false;

        updateOutputPane();
    }

    function startAutoComplete(ed) {
        if (autoComplete.isActive() == false) {
            typeScriptLS.updateScript(selectFileName + ".ts", editor.getSession().getDocument().getValue(), false);
            autoComplete.setScriptName(selectFileName);
            autoComplete.active();
        }
    }

    function onUpdateTypescriptDocument(e) {
        if (selectFileName) {
            if (!syncStop) {
                try {
                    syncTypeScriptServiceContent(selectFileName, e);
                    updateMarker(e);
                } catch (ex) {
                }
            }
        }
    }
    function onUpdateDocument(e) {
        updateOutputPane();
    }

    function updateMarker(aceChangeEvent) {
        var data = aceChangeEvent.data;
        var action = data.action;
        var range = data.range;
        var markers = editor.getSession().getMarkers(true);
        var line_count = 0;
        var isNewLine = editor.getSession().getDocument().isNewLine;

        if (action == "insertText") {
            if (isNewLine(data.text)) {
                line_count = 1;
            }
        } else if (action == "insertLines") {
            line_count = data.lines.length;

        } else if (action == "removeText") {
            if (isNewLine(data.text)) {
                line_count = -1;
            }

        } else if (action == "removeLines") {
            line_count = -data.lines.length;
        }

        if (line_count != 0) {

            var markerUpdate = function (id) {
                var marker = markers[id];
                var row = range.start.row;

                if (line_count > 0) {
                    row = +1;
                }

                if (marker && marker.range.start.row > row) {
                    marker.range.start.row += line_count;
                    marker.range.end.row += line_count;
                }
            };

            errorMarkers.forEach(markerUpdate);
            runtimeErrorMarkers.forEach(markerUpdate);
            refMarkers.forEach(markerUpdate);
            editor.onChangeFrontMarker();
        }

    }

    function TextEdit(minChar, limChar, text) {
        this.minChar = minChar;
        this.limChar = limChar;
        this.text = text;
    }

    //sync LanguageService content and ace editor content
    function syncTypeScriptServiceContent(script, aceChangeEvent) {

        var data = aceChangeEvent.data;
        var action = data.action;
        var range = data.range;
        var start = aceEditorPosition.getPositionChars(range.start);

        if (action == "insertText") {
            editLanguageService(script, new TextEdit(start, start, data.text));
        } else if (action == "insertLines") {

            var text = data.lines.map(function (line) {
                return line + '\n'; //TODO newline hard code
            }).join('');
            editLanguageService(script, new TextEdit(start, start, text));

        } else if (action == "removeText") {
            var end = start + data.text.length;
            editLanguageService(script, new TextEdit(start, end, ""));
        } else if (action == "removeLines") {
            var len = aceEditorPosition.getLinesChars(data.lines);
            var end = start + len;
            editLanguageService(script, new TextEdit(start, end, ""));
        }
    };


    function editLanguageService(name, textEdit) {
        typeScriptLS.editScript(name + ".ts", textEdit.minChar, textEdit.limChar, textEdit.text);
    }

    function onChangeCursor(e) {
        if (!syncStop) {
            try {
                deferredShowOccurrences.schedule(200);
            } catch (ex) {
                //TODO
            }
        }
    };

    function languageServiceIndent() {
        var cursor = editor.getCursorPosition();
        var lineNumber = cursor.row;

        var text = editor.session.getLine(lineNumber);
        var matches = text.match(/^[\t ]*/);
        var preIndent = 0;
        var wordLen = 0;

        if (matches) {
            wordLen = matches[0].length;
            for (var i = 0; i < matches[0].length; i++) {
                var elm = matches[0].charAt(i);
                var spaceLen = (elm == " ") ? 1 : editor.session.getTabSize();
                preIndent += spaceLen;
            };
        }

        var option = {};
        option.NewLineCharacter = "\n";

        var smartIndent = languageService.getIndentationAtPosition(selectFileName + ".ts", lineNumber, option);

        editor.indent();
        /*
        if(preIndent > smartIndent){
            
        }else{
            var indent = smartIndent - preIndent;
            if (indent == 0) // hack
                indent = 1;
            if(indent > 0){
                editor.getSelection().moveCursorLineStart();
                editor.commands.exec("inserttext", editor, {text:" ", times:indent});
            }

            if( cursor.column > wordLen){
                cursor.column += indent;
            }else{
                cursor.column = indent + wordLen;
            }

            editor.getSelection().moveCursorToPosition(cursor);
        }*/
    }

    function showOccurrences() {
        var references = languageService.getOccurrencesAtPosition(selectFileName + ".ts", aceEditorPosition.getCurrentCharPosition());
        var session = editor.getSession();
        refMarkers.forEach(function (id) {
            session.removeMarker(id);
        });
        if (typeof references === "undefined" || references == null)
            return;

        references.forEach(function (ref) {
            if (ref.fileName == selectFileName + ".ts") {
                //TODO check script name
                // console.log(ref.unitIndex);
                var getpos = aceEditorPosition.getAcePositionFromChars;
                var start = getpos(ref.textSpan.start);
                var end = getpos(ref.textSpan.start + ref.textSpan.length);
                var range = new AceRange(start.row, start.column, end.row, end.column);
                refMarkers.push(session.addMarker(range, "typescript-ref", "text", true));
            }
        });
    }

    var deferredShowOccurrences = deferredCall(showOccurrences);

    function workerOnCreate(func, timeout) {
        if (editor.getSession().$worker) {
            func(editor.getSession().$worker);
        } else {
            setTimeout(function () {
                workerOnCreate(func, timeout);
            });
        }
    }


    function refactor() {
        typeScriptLS.updateScript(selectFileName + ".ts", editor.getSession().getDocument().getValue(), false);
        var references = languageService.getOccurrencesAtPosition(selectFileName + ".ts", aceEditorPosition.getCurrentCharPosition());
        if (typeof references === "undefined" || references == null)
            return;

        references.forEach(function (ref) {
            var getpos = aceEditorPosition.getAcePositionFromChars;
            var start = getpos(ref.textSpan.start);
            var end = getpos(ref.textSpan.start + ref.textSpan.length);
            var range = new AceRange(start.row, start.column, end.row, end.column);
            editor.session.multiSelect.addRange(range);
        });
    }

    function formatDocument() {
        typeScriptLS.updateScript(selectFileName + ".ts", editor.getSession().getDocument().getValue(), false);
        var textChanges = languageService.getFormattingEditsForRange(selectFileName + ".ts", 0, editor.getValue().length, defaultFormatCodeOptions());
        for (var i = textChanges.length - 1; i >= 0; i--) {

            var textChange = textChanges[i];

            var startPos = editor.getSession().getDocument().indexToPosition(textChange.span.start);
            var endPos = editor.getSession().getDocument().indexToPosition(textChange.span.start + textChange.span.length);
            var range = new AceRange(startPos.row, startPos.column, endPos.row, endPos.column);
            editor.getSession().getDocument().replace(range, textChange.newText);
        }
    }

    function defaultFormatCodeOptions() {
        return {
            IndentSize: 4,
            TabSize: 4,
            NewLineCharacter: '\n',
            ConvertTabsToSpaces: true,
            InsertSpaceAfterCommaDelimiter: true,
            InsertSpaceAfterSemicolonInForStatements: true,
            InsertSpaceBeforeAndAfterBinaryOperators: true,
            InsertSpaceAfterKeywordsInControlFlowStatements: true,
            InsertSpaceAfterFunctionKeywordForAnonymousFunctions: false,
            InsertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
            PlaceOpenBraceOnNewLineForFunctions: false,
            PlaceOpenBraceOnNewLineForControlBlocks: false,
        };
    }

    var previousCursorPositionStack = [];
    function gotoDefinition() {
        typeScriptLS.updateScript(selectFileName + ".ts", editor.getSession().getDocument().getValue(), false);
        var definitionInfos = languageService.getDefinitionAtPosition(selectFileName + ".ts", aceEditorPosition.getCurrentCharPosition());
        if (typeof definitionInfos !== "undefined" && definitionInfos.length > 0) {
            var definitionInfo = definitionInfos[0];
            previousCursorPositionStack.push(editor.getCursorPosition());
            var startPos = editor.getSession().getDocument().indexToPosition(definitionInfo.textSpan.start);
            editor.gotoLine(startPos.row + 1, startPos.col, true);
        }
    }

    function gotoPreviousPosition() {
        if (previousCursorPositionStack.length > 0) {
            var pos = previousCursorPositionStack.pop();
            editor.gotoLine(pos.row + 1, pos.col);
        }
    }

    function getPositionInTypescriptFromJavascript(linenr, col, sourcemap) {
        var lines = sourcemap.mappings.split(';');


        if (linenr >= 1 && linenr <= lines.length) {

            if (lines[linenr - 1].length <= 0) // empty line
                return null;

            var sourceFileIndex = 0;
            var sourceCodeLine = 0;
            var sourceCodeColumn = 0;

            // skip forward to the actual line, but because every value is relative 
            // we still need to parse the previous lines
            for (var j = 0; j < linenr - 1; j++) {
                if (lines[j].length > 0) {
                    var segments = lines[j].split(',').map(vlq.decode);
                    for (var i = 0; i < segments.length; i++) {
                        sourceFileIndex += segments[i][1];
                        sourceCodeLine += segments[i][2];
                        sourceCodeColumn += segments[i][3];
                    }
                }
            }

            var line = lines[linenr - 1];
            var segments = line.split(',').map(vlq.decode);
            var destCol = 0;
            for (var i = 0; i < segments.length; i++) {
                if (col >= destCol && col < destCol + segments[i][0]) {
                    return {
                        sourceRow: sourceCodeLine,
                        sourceCol: sourceCodeColumn,
                        sourceColEnd: sourceCodeColumn + segments[i][3]
                    };
                }
                destCol += segments[i][0];
                sourceFileIndex += segments[i][1];
                sourceCodeLine += segments[i][2];
                sourceCodeColumn += segments[i][3];
            }
            if (col >= destCol) {
                return {
                    sourceRow: sourceCodeLine,
                    sourceCol: sourceCodeColumn,
                    sourceColEnd: Infinity
                };
            }
        }
        return null;
    }


    $(function () {
        appFileService = new FileService($);

        var theme = "ace/theme/github";
        editorHTML = ace.edit("editorHTML");
        //editorHTML.setTheme(theme);
        editorHTML.getSession().setMode('ace/mode/html');

        editorCSS = ace.edit("editorCSS");
        //editorCSS.setTheme(theme);
        editorCSS.getSession().setMode('ace/mode/css');

        editor = ace.edit("editorTypescript");
        editor.setTheme(theme);
        editor.getSession().setMode('ace/mode/typescript');

        editorJavascript = ace.edit("editorJavascript");
        editorJavascript.setTheme(theme);
        editorJavascript.getSession().setMode('ace/mode/javascript');
        editorJavascript.setReadOnly(true);

        document.getElementById('editorTypescript').style.fontSize = '14px';
        document.getElementById('editorJavascript').style.fontSize = '14px';
        document.getElementById('editorHTML').style.fontSize = '14px';
        document.getElementById('editorCSS').style.fontSize = '14px';

        loadTypeScriptLibrary();

        editor.addEventListener("change", onUpdateTypescriptDocument);
        editorHTML.addEventListener("change", onUpdateDocument);
        editorCSS.addEventListener("change", onUpdateDocument);

        editor.addEventListener("changeSelection", onChangeCursor);

        editor.commands.addCommands([{
            name: "autoComplete",
            bindKey: "Ctrl-Space",
            exec: function (editor) {
                startAutoComplete(editor);
            }
        }]);

        editor.commands.addCommands([{
            name: "refactor",
            bindKey: "F2",
            exec: function (editor) {
                refactor();
            }
        }]);

        editor.commands.addCommands([{
            name: "indent",
            bindKey: "Tab",
            exec: function (editor) {
                //editor.indent();
                languageServiceIndent();
            },
            multiSelectAction: "forEach"
        }]);

        editor.commands.addCommands([{
            name: "formatDocument",
            bindKey: "Ctrl-D",
            exec: function (editor) {
                formatDocument();
            }
        }]);

        editor.commands.addCommands([{
            name: "gotoDefinition",
            bindKey: "F12",
            exec: function (editor) {
                gotoDefinition();
            }
        }]);

        editor.commands.addCommands([{
            name: "gotoPreviousPosition",
            bindKey: "Shift-F12",
            exec: function (editor) {
                gotoPreviousPosition();
            }
        }]);

        aceEditorPosition = new EditorPosition(editor);
        typeCompilationService = new CompilationService(editor, languageService);
        autoComplete = new AutoComplete(editor, selectFileName, typeCompilationService, ts);

        // override editor onTextInput
        var originalTextInput = editor.onTextInput;
        editor.onTextInput = function (text) {
            originalTextInput.call(editor, text);
            if (text == ".") {
                editor.commands.exec("autoComplete");

            } else if (editor.getSession().getDocument().isNewLine(text)) {
                var lineNumber = editor.getCursorPosition().row;
                var option = {};
                option.NewLineCharacter = "\n";
                var indent = languageService.getIndentationAtPosition(selectFileName + ".ts", lineNumber, option);
                var curIndent = editor.session.getLine(lineNumber).length;
                if (indent - curIndent > 0) {
                    editor.commands.exec("inserttext", editor, { text: " ", times: indent - curIndent });
                }
            }
        };

        editor.addEventListener("mousedown", function (e) {
            if (autoComplete.isActive()) {
                autoComplete.deactivate();
            }
        });

        editor.getSession().on("compiled", function (e) {
            var js = e.data.javascript;
            var sourcemap = $.parseJSON(e.data.mapping);
            javascriptSourceMap = sourcemap;
            editorJavascript.getSession().doc.setValue(js);

            updateOutputPane();

            // remove the runtime errors
            runtimeErrorMarkers.forEach(function (id) {
                editor.getSession().removeMarker(id);
            });
            runtimeErrorMarkers = [];
        });


        editor.getSession().on("compileErrors", function (e) {
            var session = editor.getSession();
            errorMarkers.forEach(function (id) {
                session.removeMarker(id);
            });
            errorMarkers = [];

            e.data.forEach(function (error) {
                var getpos = aceEditorPosition.getAcePositionFromChars;
                var start = getpos(error.minChar);
                var end = getpos(error.limChar);
                var range = new AceRange(start.row, start.column, end.row, end.column);
                errorMarkers.push(session.addMarker(range, "typescript-error", "text", true));

                // remove the runtime errors
                runtimeErrorMarkers.forEach(function (id) {
                    session.removeMarker(id);
                });
                runtimeErrorMarkers = [];
            });

            updateErrors();
        });

        workerOnCreate(function () {//TODO use worker init event            
            ["typescripts/lib.d.ts", "typescripts/jquery.d.ts"].forEach(function (libname) {
                appFileService.readFile(libname, function (content) {
                    var params = {
                        data: {
                            name: libname,
                            content: content.replace(/\r\n?/g, "\n")
                        }
                    };
                    editor.getSession().$worker.emit("addLibrary", params);
                });
            });
        }, 100);


        function addLibrary(libname) {
            appFileService.readFile(libname, function (content) {
                var params = {
                    data: {
                        name: libname,
                        content: content.replace(/\r\n?/g, "\n")
                    }
                };
                editor.getSession().$worker.emit("addLibrary", params);
            });
        }

        $(".tab").click(function (e) {
            var id = $(this).attr("data-target");
            var el = document.getElementById(id);
            $(this).toggleClass("active");
            if ($(this).hasClass("active"))
                $(el).show();
            else
                $(el).hide();

            updateSideBySide();
        });

        $(".tab[data-target=tab-output]").click(function (e) {
            updateOutputPane();
        });

        function updateSideBySide() {
            var activeTabs = $(".tab.active");
            var perc = Math.floor(100 / activeTabs.length);
            for (var i = 0; i < activeTabs.length; i++) {
                var el = document.getElementById($(activeTabs[i]).attr("data-target"));
                $(el).css("width", perc + "%");
                $(el).show();
            }

            editorHTML.resize();
            editorCSS.resize();
            editor.resize();
            editorJavascript.resize();

            var tabs = $(".tab");
            for (var i = 0; i < tabs.length; i++) {
                if (!$(tabs[i]).hasClass("active")) {
                    var el = document.getElementById($(tabs[i]).attr("data-target"));
                    $(el).hide();
                }
            }
        }
        updateSideBySide();

        $("#errorsTypescript").click(function (ev) {
            var lines = $("#errorsTypescript").attr("data-lines").split(',');
            var curIdx = parseInt($("#errorsTypescript").attr("data-curidx"));

            editor.gotoLine(parseInt(lines[curIdx])+1, 0, true);
            curIdx++;
            curIdx = curIdx % lines.length;
            $("#errorsTypescript").attr("data-curidx", curIdx);
        });
    });

    function updateErrors() {
        var annotations = editor.getSession().getAnnotations();

        if (annotations.length > 0) {
            var lines = [];
            annotations.forEach(function (a) { lines.push(a.row) });

            $("#errorsTypescript").text(annotations.length + " error(s)");
            $("#errorsTypescript").attr("data-lines", lines.join(","));
            $("#errorsTypescript").attr("data-curidx", 0);
            $("#errorsTypescript").show();
        }
        else {
            $("#errorsTypescript").hide();
        }
    }

    /*
        All logic for the output pane/external window
    */

    $(function () {
        $("#lnkRunExternalWindow").click(function (ev) {
            runInExternalWindow();

            ev.preventDefault();
            return true;
        });

        $("#chkRunJavascript").click(function (ev) {
            updateOutputPane();

            ev.preventDefault();
            return true;
        })
    });

    var externalWindow = null;
    var externalIfrm = null;
    function runInExternalWindow() {
        if (externalWindow != null && !externalWindow.closed)
            externalWindow.focus();
        else {
            externalWindow = window.open();
        }
        updateExternalWindow();
    }

    function updateExternalWindow() {
        if (externalWindow != null && !externalWindow.closed) {
            var htmlText = getOutputHTML(true);
            resetWindow(externalWindow, htmlText);
        }
    }

    function resetWindow(wnd, html) {
        // problem: the window element is not reset, so previous values are retained

        var session = editor.getSession();
        runtimeErrorMarkers.forEach(function (id) {
            session.removeMarker(id);
        });
        runtimeErrorMarkers = [];

        // this is horrible
        var maxId = wnd.setTimeout(function () { }, 0);
        for (var i = 0; i < maxId; i += 1) {
            wnd.clearTimeout(i);
        }

        wnd.document.open();

        // register onerror and console.log before closing the document, or the code will run in the window before the handlers are registered
        if (wnd.onerror == null) {
            wnd.onerror = function (errorMsg, url, lineNumber, column, errorObj) {
                if (errorMsg.indexOf('Script error.') > -1) {
                    return;
                }
                else {
                    if (typeof column === "undefined")
                        column = 0;

                    if ($.browser.mozilla) {
                        lineNumber = lineNumber - lineNumberOffsetOnPage + 1;
                    }
                    handleRuntimeError(errorMsg, url, lineNumber, column, errorObj);
                }
            };
        }
        clearConsoleLog();
        wnd.console.log = function (message) {
            addConsoleLog(message);
        }

        wnd.document.write(html);
        wnd.document.close();
    }

    function addConsoleLog(message) {
        var logger = $("#txtConsole").get(0);

        var html;
        if (typeof message == 'object')
            html = (JSON && JSON.stringify ? JSON.stringify(message) : message);
        else
            html = message;
        logger.innerHTML += "<div class='console-entry'>" + html + "</div>";

        logger.scrollTop = logger.scrollHeight;
        if ($("#txtConsole").children().length > 100) {
            $($("#txtConsole").children()[0]).empty().detach();
        }
    }

    function clearConsoleLog() {
        $("#txtConsole").empty();
    }

    function handleRuntimeError(errorMsg, url, lineNumber, column, errorObj) {
        var session = editor.getSession();
        runtimeErrorMarkers.forEach(function (id) { session.removeMarker(id); });
        runtimeErrorMarkers = [];

        var stacktrace = "";
        var jsStacktrace = "";
        if (typeof errorObj !== "undefined" && errorObj != null) {
            if (typeof errorObj.stack !== "undefined") {
                var lines = errorObj.stack.split('\n').slice(2);

                jsStacktrace = "\n" + lines.join("\n");
            }
        }

        var tsLineNumber = lineNumber;
        if (column == 0)
            tsLineNumber++;

        var typescriptPos = getPositionInTypescriptFromJavascript(tsLineNumber, column, javascriptSourceMap);
        if (typescriptPos != null) {
            var range = new AceRange(typescriptPos.sourceRow, typescriptPos.sourceCol, typescriptPos.sourceRow, typescriptPos.sourceColEnd);
            runtimeErrorMarkers.push(session.addMarker(range, "typescript-error", "line", true));
            runtimeErrorMarkers.push(session.addMarker(range, "typescript-runtime-error", "fullLine"));

            var existingAnnotations = session.getAnnotations();
            var newAnnotations = [];
            // collect all previous non runtime error annotations
            for (var i = 0; i < existingAnnotations.length; i++) {
                if (typeof existingAnnotations[i].runtime === "undefined")
                    newAnnotations.push(existingAnnotations[i]);
            }

            var errAnnotation = {
                row: range.start.row,
                column: range.start.column,
                text: errorMsg + stacktrace,
                minChar: range.end.row,
                limChar: range.end.column,
                type: "error",
                raw: errorMsg,
                runtime: true
            };
            newAnnotations.push(errAnnotation);
            session.setAnnotations(newAnnotations);

            if ($("#chkMoveCursorToError").hasClass("active")) {
                editor.gotoLine(range.start.row + 1, range.start.col, true);
            }

            updateErrors();
        }

        var jsRange = new AceRange(lineNumber - 1, column, lineNumber - 1, Infinity);
        var jsErrAnnotation = {
            row: jsRange.start.row,
            column: jsRange.start.column,
            text: errorMsg + stacktrace,
            minChar: jsRange.end.row,
            limChar: jsRange.end.column,
            type: "error",
            raw: errorMsg,
            runtime: true
        };
        runtimeErrorMarkers.push(editorJavascript.getSession().addMarker(jsRange, "typescript-error", "line", true));
        runtimeErrorMarkers.push(editorJavascript.getSession().addMarker(jsRange, "typescript-runtime-error", "fullLine"));

        // update javascript window too
        editorJavascript.getSession().setAnnotations([jsErrAnnotation]);
        if ($("#chkMoveCursorToError").hasClass("active")) {
            editorJavascript.gotoLine(lineNumber, column, true);
        }

    }

    function getOutputHTML(includeJavascript) {
        var htmlText = editorHTML.getSession().doc.getValue();
        var javascriptText = "<script>" + editorJavascript.getSession().doc.getValue() + "</script>";
        var cssText = "<style>" + editorCSS.getSession().doc.getValue() + "</style>";

        htmlText = htmlText.replace("<!--%CSS%-->", cssText);

        if (includeJavascript) {
            var idx = htmlText.indexOf("<!--%Javascript%-->");
            if (idx != -1) {
                var nrOfLinesToJavascript = htmlText.substring(0, idx).split('\n').length;
                lineNumberOffsetOnPage = nrOfLinesToJavascript;
            }
            htmlText = htmlText.replace("<!--%Javascript%-->", javascriptText);
        }

        return htmlText;
    }

    var outputUpdateTimer = null;
    function updateOutputPane() {
        if (outputUpdateTimer != null)
            window.clearTimeout(outputUpdateTimer);

        outputUpdateTimer = window.setTimeout(function () {
            if ($("#tab-output").is(":visible")) {
                var htmlText = getOutputHTML($("#chkRunJavascript").hasClass("active"));
                var iframe = $("#outputIFrame").get(0);
                resetWindow(iframe.contentWindow, htmlText);
            }

            updateExternalWindow();
        }, 500);
    }






    /* 
        Business logic to start from a new document, load, save and create a milestone.
        All the REST interactions are grouped together in the RestServices class.
    */



    var restService = new RestServices();

    var ignoreHash = false;
    function openFromHash(newHash) {
        var hash = newHash;
        newHash = hash.substr(1, hash.length - 1);
        var file = newHash.split('-')[0];
        var milestone;
        if (newHash.indexOf('-') == -1)
            milestone = -1;
        else
            milestone = newHash.split('-')[1];

        if (selectFileName != file || milestone != selectMilestone) {
            if (confirmIfDirty())
                restService.loadFile(file, milestone);
        }
    }
    function setHash(hash) {
        ignoreHash = true;
        window.location.hash = hash;
    }

    function confirmIfDirty() {
        return true; // TODO
    }

    $(function () {
        // start from a new file
        if (location.hash == "")
            restService.newFile();
        else
            openFromHash(location.hash);

        $("#lnkNew").click(function (ev) {
            restService.newFile();

            ev.preventDefault();
            return true;
        });

        $("#lnkOpen").click(function (ev) {
            if (confirmIfDirty()) {
                restService.listFiles();
                $('#modalFiles').modal();
            }
            ev.preventDefault();
            return true;
        });

        $("#lstFiles").on("click", ".item", function (ev) {
            if (!$(ev.srcElement).parent().hasClass("lnkDelete")) {
                $('#modalFiles').modal('hide');
                restService.loadFile($(this).attr("data-name"));
            }
            ev.preventDefault();
            return true;
        });

        $("#lstFiles").on("click", ".item .lnkDelete", function (ev) {
            if (confirm("Are you sure?"))
                var item = $(this);
            restService.deleteFile($(this).attr("data-name"), function (completeEntryDeleted) {
                if (completeEntryDeleted)
                    item.parent().empty().detach();
                else {
                    var milestone = parseInt(item.parent().find(".badge").text());
                    milestone--;
                    item.parent().find(".badge").text(milestone);
                }
            });

            ev.preventDefault();
            return true;
        });

        $("#lnkSave").click(function (ev) {
            restService.saveFile(selectFileName, editorHTML.getValue(), editorCSS.getValue(), editor.getValue());

            ev.preventDefault();
            return true;
        });

        $("#lnkCreateMilestone").click(function (ev) {
            $('#modalCreateMilestone').modal();
            ev.preventDefault();
            return true;
        });

        $("#btnCreateMilestone").click(function (ev) {
            $('#modalCreateMilestone').modal('hide');
            restService.createMilestone(selectFileName, editorHTML.getValue(), editorCSS.getValue(), editor.getValue(), $("#txtMilestoneComments").val());
        });

        $("#lnkUpdateDescription").click(function (ev) {
            $('#modalUpdateDescription').modal();
            ev.preventDefault();
            return true;
        });

        $("#btnUpdateDescription").click(function (ev) {
            $('#modalUpdateDescription').modal('hide');
            restService.updateDescription(selectFileName, $("#txtDescription").val());
        });

        $(window).bind('hashchange', function () {
            if (!ignoreHash) {
                openFromHash(location.hash);
            }
            ignoreHash = false;
        });
    });


    function showNotification(msg, type) {
        if (type == "info") {
            $("#lblNotification").parent().css("backgroundColor", "#CCCCCC");
        }
        else if (type == "warning") {
            $("#lblNotification").parent().css("backgroundColor", "#FFFFCC");
        }
        else if (type == "error") {
            $("#lblNotification").parent().css("backgroundColor", "#FFCCCC");
        }

        $("#lblNotification").text(msg);
        $("#lblNotification").parent().stop().fadeIn(200, function () {
            $("#lblNotification").parent().delay(2000).fadeOut();
        });
    }

    function RestServices() {
        var self = this;
        var restBaseUrl = "/typescripteditorapi/";

        function newFile() {
            $.post(restBaseUrl + "newFile", function (resp) {
                if (resp.Success) {
                    //resp.Result.Name
                    loadInEditors(resp.Result.Name, resp.Result.Milestone, resp.Result.HTML, resp.Result.CSS, resp.Result.Typescript);
                    setHash(resp.Result.Name + "-" + resp.Result.Milestone);
                }
                else {
                    showNotification("Unable to create new file", "error");
                }
            }).fail(function () {
                showNotification("Unable to create new file", "error");
            });
        }
        self.newFile = newFile;

        function loadFile(file, milestone) {
            if (typeof (milestone) == "undefined")
                milestone = -1;

            $.post(restBaseUrl + "loadFile", { file: file, milestone: milestone }, function (resp) {
                if (resp.Success) {

                    loadInEditors(resp.Result.Name, resp.Result.Milestone, resp.Result.HTML, resp.Result.CSS, resp.Result.Typescript, resp.Result.Description);
                    setHash(resp.Result.Name + "-" + resp.Result.Milestone);
                    showNotification("Loaded " + resp.Result.Name + " successfully", "info");
                }
                else {
                    showNotification("Unable to load file", "error");
                }
            });
        }
        self.loadFile = loadFile;

        function listFiles() {
            $.post(restBaseUrl + "listFiles", function (resp) {
                if (resp.Success) {
                    $("#lstFiles").empty();
                    var items = [];
                    for (var i = 0; i < resp.Result.length; i++) {
                        items.push($("<li class='list-group-item item' data-name='" + resp.Result[i].Name + "'>" +
                                     "<a href='#'>" +
                                     resp.Result[i].Name +
                                     "<span class='lnkDelete pull-right' data-name='" + resp.Result[i].Name + "'><i class='icon-remove'></i></span>" +
                                     "<span class='badge pull-right'>" + resp.Result[i].Milestone + "</span>" +
                                     "<span class='date pull-right'>" + resp.Result[i].LastUpdated + "</span>" +
                                     "<br/>" +
                                     "<span class='description'>" + resp.Result[i].Description + "</span>" +
                                     "</a>" +
                                     "</li>"));
                    }
                    $("#lstFiles").append(items);
                }
                else {
                    showNotification("Unable to list files", "error");
                }
            });
        }
        self.listFiles = listFiles;

        function saveFile(name, html, css, typescript) {
            var file = {
                name: name,
                html: html,
                css: css,
                typescript: typescript,
                output: getOutputHTML(true)
            };
            $.post(restBaseUrl + "saveFile", file, function (resp) {
                if (resp.Success) {
                    // show notification saved
                    showNotification("Saved successfully", "info");
                }
                else {
                    showNotification("Unable to save", "error");
                }
            }).fail(function () {
                showNotification("Unable to save", "error");
            });

        }
        self.saveFile = saveFile;

        function deleteFile(name, onsuccess) {
            $.post(restBaseUrl + "deleteMilestone", { name: name }, function (resp) {
                if (resp.Success) {
                    if (typeof onsuccess !== "undefined") {
                        onsuccess(resp.Result);
                    }
                }
                else {
                    showNotification("Unable to delete", "error");
                }
            }).fail(function () {
                showNotification("Unable to delete", "error");
            });
        }
        self.deleteFile = deleteFile;

        function createMilestone(name, html, css, typescript, comments) {
            var file = {
                name: name,
                html: html,
                css: css,
                typescript: typescript,
                output: getOutputHTML(true),
                comments: comments
            };
            $.post(restBaseUrl + "createMilestone", file, function (resp) {
                if (resp.Success) {
                    // resp.Result.Milestone
                    updateHeader(resp.Result.Name, resp.Result.Milestone, resp.Result.Description);
                    setHash(resp.Result.Name + "-" + resp.Result.Milestone);
                    showNotification("Milestone " + resp.Result.Milestone + " created", "info");
                }
                else {
                    showNotification("Unable to create milestone", "error");
                }
            }).fail(function () {
                showNotification("Unable to create milestone", "error");
            });
        }
        self.createMilestone = createMilestone;

        function updateDescription(name, description) {
            $.post(restBaseUrl + "updateDescription", { name: name, description: description }, function (resp) {
                if (resp.Success) {

                    showNotification("Description updated", "info");
                    $("#txtHeaderDescription").text(description);
                }
                else {
                    showNotification("Unable to update description", "error");
                }
            }).fail(function () {
                showNotification("Unable to update description", "error");
            });
        }
        self.updateDescription = updateDescription;
    }


    function LocalRestServices() {
        var self = this;

        function saveObj(key, obj) {
            window.localStorage[key] = JSON.stringify(obj);
        }
        function loadObj(key) {
            var str = window.localStorage[key];
            if (typeof str === "undefined" || str == null)
                return null;

            return JSON.parse(str);
        }

        if (loadObj("entries") == null)
            saveObj("entries", {});

        function downloadExampleIfNotAvailable() {
            if (typeof loadObj("entries")["example"] === "undefined") {
                var sampleEntry = {
                    Name: "example",
                    LastMilestone: 1,
                    Description: "Particles example",
                    Milestones: [
                        {
                            HTML: getDefaultHTML(),
                            CSS: getDefaultCSS(),
                            Typescript: getDefaultTypescript(),
                            Comments: ""
                        }]
                };
                var entries = loadObj("entries");
                entries["example"] = sampleEntry;
                saveObj("entries", entries);

                function checkExampleReady() {
                    if (exampleReady < 3)
                        return;
                    if (confirm("Load example?")) {
                        self.loadFile("example", 1);
                    }
                }
                var exampleReady = 0;
                $.get("samples/particles.html", function (data) {
                    var entries = loadObj("entries");
                    entries["example"].Milestones[0].HTML = data;
                    saveObj("entries", entries);
                    exampleReady++;
                    checkExampleReady();
                });

                $.get("samples/particles.css", function (data) {
                    var entries = loadObj("entries");
                    entries["example"].Milestones[0].CSS = data;
                    saveObj("entries", entries);
                    exampleReady++;
                    checkExampleReady();
                });

                $.get("samples/particles.ts", function (data) {
                    var entries = loadObj("entries");
                    entries["example"].Milestones[0].Typescript = data;
                    saveObj("entries", entries);
                    exampleReady++;
                    checkExampleReady();
                }, "text");
            }
        }
        function downloadClusteringExampleIfNotAvailable() {
            if (typeof loadObj("entries")["clustering"] === "undefined") {
                var sampleEntry = {
                    Name: "clustering",
                    LastMilestone: 1,
                    Description: "Kruskal clustering with generics",
                    Milestones: [
                        {
                            HTML: getDefaultHTML(),
                            CSS: getDefaultCSS(),
                            Typescript: getDefaultTypescript(),
                            Comments: ""
                        }]
                };
                var entries = loadObj("entries");
                entries["clustering"] = sampleEntry;
                saveObj("entries", entries);

                $.get("samples/clustering.html", function (data) {
                    var entries = loadObj("entries");
                    entries["clustering"].Milestones[0].HTML = data;
                    saveObj("entries", entries);
                });

                $.get("samples/clustering.css", function (data) {
                    var entries = loadObj("entries");
                    entries["clustering"].Milestones[0].CSS = data;
                    saveObj("entries", entries);
                });

                $.get("samples/clustering.ts", function (data) {
                    var entries = loadObj("entries");
                    entries["clustering"].Milestones[0].Typescript = data;
                    saveObj("entries", entries);
                }, "text");
            }
        }

        downloadExampleIfNotAvailable();
        downloadClusteringExampleIfNotAvailable();

        function generateNewName() {
            var chars = "bcdfghjklmnpqrstvwxz";
            var vowels = "aeiou";
            var str = "";
            for (var i = 0; i < 8; i++) {
                if (i % 2 == 0)
                    str += chars[Math.floor(Math.random() * chars.length)];
                else
                    str += vowels[Math.floor(Math.random() * vowels.length)];
            }
            return str;
        }

        function generateUniqueNewName() {
            var errCount = 0;
            var name = generateNewName();
            while (typeof loadObj("entries")[name] !== "undefined")
                name = GenerateNewName();
            return name;
        }

        function getDefaultHTML() {
            return "<html>\n" +
                    "    <head>\n" +
                    "       <title>Typescript Editor - Hello</title>\n" +
                    "       <!--%CSS%-->\n" +
                    "    </head>\n" +
                    "    <body>\n" +
                    "        <h1>Greeter example</h1>\n" +
                    "    </body>\n" +
                    "    <!--%Javascript%-->\n" +
                    "</html>";
        }
        function getDefaultCSS() {
            return "body {\n" +
                   "\n" +
                   "};"
        }
        function getDefaultTypescript() {
            return "class Hello {\n" +
                   "\n" +
                   "}";
        }

        function newFile() {
            try {
                var newname = generateUniqueNewName();

                var entry = {
                    Name: newname,
                    LastMilestone: 1,
                    Description: "",
                    Milestones: [
                        {
                            HTML: getDefaultHTML(),
                            CSS: getDefaultCSS(),
                            Typescript: getDefaultTypescript(),
                            Comments: ""
                        }]
                };

                /* Don't pollute the localstorage with the same new templates
                var entries = loadObj("entries");
                entries[entry.Name] = entry;
                saveObj("entries", entries);*/

                var milestone = entry.Milestones[entry.LastMilestone - 1];

                loadInEditors(entry.Name, entry.LastMilestone, milestone.HTML, milestone.CSS, milestone.Typescript);
                setHash(entry.Name + "-" + entry.LastMilestone);
            }
            catch (e) {
                showNotification("Unable to create new file", "error");
            }
        }
        self.newFile = newFile;

        function loadFile(file, milestone) {
            try {
                if (typeof (milestone) == "undefined")
                    milestone = -1;

                var entries = loadObj("entries");
                var entry = entries[file];

                if (typeof entry !== "undefined") {
                    var milestone = entry.Milestones[entry.LastMilestone - 1];
                    loadInEditors(entry.Name, entry.LastMilestone, milestone.HTML, milestone.CSS, milestone.Typescript, entry.Description);
                    setHash(entry.Name + "-" + entry.LastMilestone);
                    showNotification("Loaded " + entry.Name + " successfully", "info");
                }
                else {
                    showNotification("Unable to load file", "error");
                }
            }
            catch (e) {
                showNotification("Unable to load file", "error");
            }
        }
        self.loadFile = loadFile;

        function listFiles() {
            var entries = loadObj("entries");

            $("#lstFiles").empty();
            var items = [];
            for (var key in entries) {
                var e = entries[key];
                items.push($("<li class='list-group-item item' data-name='" + e.Name + "'>" +
                                "<a href='#'>" +
                                e.Name +
                                "<span class='lnkDelete pull-right' data-name='" + e.Name + "'><i class='icon-remove'></i></span>" +
                                "<span class='badge pull-right'>" + e.LastMilestone + "</span>" +
                                "<br/>" +
                                "<span class='description'>" + e.Description + "</span>" +
                                "</a>" +
                                "</li>"));
            }
            $("#lstFiles").append(items);
        }
        self.listFiles = listFiles;

        function createEntryIfNotExists(name) {
            var entries = loadObj("entries");
            var entry = entries[name];
            if (typeof entry === "undefined") {
                var entry = {
                    Name: name,
                    LastMilestone: 1,
                    Description: "",
                    Milestones: [
                        {
                            HTML: "",
                            CSS: "",
                            Typescript: "",
                            Comments: ""
                        }]
                };
                entries[name] = entry;
                saveObj("entries", entries);
            }
        }

        function saveFile(name, html, css, typescript) {
            try {
                createEntryIfNotExists(name);
                var entries = loadObj("entries");
                var entry = entries[name];

                var milestone = entry.Milestones[entry.LastMilestone - 1];
                milestone.HTML = html;
                milestone.CSS = css;
                milestone.Typescript = typescript;
                saveObj("entries", entries);

                showNotification("Saved successfully", "info");
            }
            catch (e) {
                showNotification("Unable to save", "error");
            }
        }
        self.saveFile = saveFile;


        function deleteFile(name, onsuccess) {
            try {
                var entries = loadObj("entries");
                var entry = entries[name];
                if (typeof entry === "undefined")
                    return;


                if (entry.LastMilestone > 1) {
                    entry.Milestones.pop();
                    entry.LastMilestone--;
                    saveObj("entries", entries);

                    if (typeof onsuccess !== "undefined") {
                        onsuccess(false);
                    }
                }
                else {
                    delete entries[name];
                    if (typeof onsuccess !== "undefined") {
                        onsuccess(true);
                    }
                }
            }
            catch (e) {
                showNotification("Unable to delete", "error");
            }
        }
        self.deleteFile = deleteFile;

        function createMilestone(name, html, css, typescript, comments) {
            try {
                createEntryIfNotExists(name);
                var entries = loadObj("entries");
                var entry = entries[name];

                entry.LastMilestone++;
                entry.Milestones.push({

                    HTML: html,
                    CSS: css,
                    Typescript: typescript
                });
                saveObj("entries", entries);

                updateHeader(entry.Name, entry.LastMilestone, entry.Description);
                setHash(entry.Name + "-" + entry.LastMilestone);

                showNotification("Milestone " + entry.LastMilestone + " created", "info");
            }
            catch (e) {
                showNotification("Unable to create milestone", "error");
            }
        }
        self.createMilestone = createMilestone;

        function updateDescription(name, description) {
            createEntryIfNotExists(name);
            var entries = loadObj("entries");
            var entry = entries[name];
            entry.Description = description;
            saveObj("entries", entries);

            showNotification("Description updated", "info");
            $("#txtHeaderDescription").text(description);
        }
        self.updateDescription = updateDescription;
    }
});
