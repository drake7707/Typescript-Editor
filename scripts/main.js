define(function (require, exports, module) {
    var INDENT_SIZE = 4;

    var ace = require('ace/ace');
    var aceLanguageTools = require("ace/ext/language_tools"); // required for snippets & autocomplete for non typescript

    var AceRange = require('ace/range').Range;
    var AutoComplete = require('AutoComplete').AutoComplete;
    var lang = require("ace/lib/lang");
    var EditorPosition = require('EditorPosition').EditorPosition;
    var CompilationService = require('CompilationService').CompilationService;
    var FileService = require('FileService').FileService;
    var deferredCall = require("ace/lib/lang").deferredCall;

    var vlq = require("lib/vlq");
    var beautifyCSS = require('lib/beautify-css');
    var beautifyHTML = require('lib/beautify-html');

    var ts = require('ace/mode/typescript/typescriptServices');
    var TypeScript = require('ace/mode/typescript/typescriptServices').TypeScript;
    var TypeScriptLS = require('ace/mode/typescript/lightHarness').TypeScriptLS;

    var saveAs = require("lib/fileSaver");

    var aceEditorPosition = null;
    var appFileService = null;

    var editor = null;
    var editorJavascript = null;
    var editorHTML = null;
    var editorCSS = null;

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

        // defer because ace will update the undo manager on a callback in the setValue
        deferredCall(function () {
            editor.session.getUndoManager().reset();
            editorHTML.session.getUndoManager().reset();
            editorCSS.session.getUndoManager().reset();

            editor.session.getUndoManager().markClean();
            editorHTML.session.getUndoManager().markClean();
            editorCSS.session.getUndoManager().markClean();
        }).schedule(100);

        deferredUpdateNavTree();

        updateOutputPane();
    }

    function insertLibraryReferenceIfNotPresent(jsUrl, cssUrl, tsUrl) {
        if (jsUrl != "") {
            var html = editorHTML.getSession().getDocument().getValue();
            var scriptTag = "<script src=\"" + jsUrl + "\"></script>";
            var regex = new RegExp(escapeRegExp(scriptTag), "g");
            var idx = html.search(regex);
            if (idx == -1) {
                idx = html.indexOf("</head>");
                editorHTML.getSession().getDocument()
                var pos = editorHTML.getSession().getDocument().indexToPosition(idx, 0);
                var startOfLineIdx = editorHTML.getSession().getDocument().positionToIndex({ row: pos.row, column: 0 }, 0);
                var nrOfSpaces = idx - startOfLineIdx;
                var padding = "";
                for (var i = 0; i < nrOfSpaces; i++)
                    padding += " ";

                editorHTML.getSession().getDocument().insert(pos, "    " + scriptTag + "\n" + padding);
            }
            else {
                // already there
            }
        }
        if (cssUrl != "") {
            var css = editorHTML.getSession().getDocument().getValue();
            var linkTag = "<link rel=\"stylesheet\" href=\"" + cssUrl + "\" />";
            var regex = new RegExp(escapeRegExp(linkTag), "g");
            var idx = html.search(regex);
            if (idx == -1) {
                idx = html.indexOf("</head>");
                var pos = editorHTML.getSession().getDocument().indexToPosition(idx, 0);

                var startOfLineIdx = editorHTML.getSession().getDocument().positionToIndex({ row: pos.row, column: 0 }, 0);
                var nrOfSpaces = idx - startOfLineIdx;
                var padding = "";
                for (var i = 0; i < nrOfSpaces; i++)
                    padding += " ";

                editorHTML.getSession().getDocument().insert(pos, "    " + linkTag + "\n" + padding);

            }
            else {
                // already there
            }
        }

        var ts = editor.getSession().getDocument().getValue();
        var referenceTag = "/// <reference path=\"" + tsUrl + "\" />";
        var regex = new RegExp(escapeRegExp(referenceTag), "g");
        var idx = ts.search(regex);
        if (idx == -1) {
            idx = ts.lastIndexOf("/// <reference");
            if (idx == -1) {
                idx = 0;
                var pos = editor.getSession().getDocument().indexToPosition(idx, 0);
                editor.getSession().getDocument().insert(pos, referenceTag + "\n");
            }
            else {
                var pos = editor.getSession().getDocument().indexToPosition(idx, 0);
                pos = { row: pos.row + 1, column: 0 };
                editor.getSession().getDocument().insert(pos, referenceTag + "\n");
            }
        }
        else {
            // already there
        }

    }

    function escapeRegExp(string) {
        return string.replace(/([.*+?^${}()|\[\]\/\\])/g, "\\$1");
    }


    var deferredUpdateNavTree = deferredCall(updateNavigationTree);

    function onUpdateTypescriptDocument(e) {
        if (selectFileName) {
            if (!syncStop) {
                try {
                    syncTypeScriptServiceContent(selectFileName, e);


                } catch (ex) {
                }
                deferredUpdateNavTree.schedule(200);

                // make sure to reset the timer while typing, the compiled event with calls updateOutputPane is called with a deferred call which means the timer will
                // already be fired before the next updateOutputPane comes through. This makes it constantly update the pane while typing, resetting the timer
                // fixes this
                resetOutputPaneTimer();
            }
        }
    }
    function onUpdateDocument(e) {
        updateOutputPane();
    }

    function updateNavigationTree() {

        var expandedItems = {};
        var checkedNavs = $(".navCheck:checked");
        for (var i = 0; i < checkedNavs.length; i++)
            expandedItems[checkedNavs[i].id] = true;
        
        var nodes = languageService.getNavigationBarItems(selectFileName + ".ts");

        var html = "";
        for (var i = 0; i < nodes.length; i++) {
            html += getNavigationListItemsFromNode(nodes[i], nodes[i].text, expandedItems);
        }
        $("#navTree").empty().html(html);

        updateNavItemFromPosition();
    }

    function updateNavItemFromPosition() {
        var curPos = aceEditorPosition.getCurrentCharPosition();

        var navItems = $(".navItem");
        navItems.removeClass("selected");

        var smallestLengthNavItem = null;
        var smallestLength = Number.MAX_VALUE;
        for (var i = 0; i < navItems.length; i++) {
            var start = parseInt(navItems[i].getAttribute("data-start"));
            var length = parseInt(navItems[i].getAttribute("data-length"));
            if (curPos > start && curPos <= start + length) {
                if (length < smallestLength)
                    smallestLengthNavItem = i;
            }
        }
        if(smallestLengthNavItem != null)
            $(navItems[smallestLengthNavItem]).addClass("selected");
    }

    function getNavigationListItemsFromNode(node, path, expandedItems) {
        var id = encodeURI(path + "." + node.text);

        var childrenHtml = "";

        node.childItems.sort(function (a, b) { a.spans[0].start - b.spans[0].start });

        for (var i = 0; i < node.childItems.length; i++) {
            childrenHtml += getNavigationListItemsFromNode(node.childItems[i], id, expandedItems);
        }

        var kind = "label-kind-" + node.kind;
        var text = node.text;

        var start = node.spans[0].start;
        var length = node.spans[0].length;

        var isLeaf = childrenHtml.length == 0;

        var span = '<span class="navItem ' + (isLeaf ? "leaf " : "") +  kind + '" data-start="' + start + '" data-length="' + length + '">' + text + '</span>';
        var html;

        var checked = "";
        if (typeof expandedItems[id] !== "undefined")
            checked = "checked";

        if (childrenHtml.length > 0) {
            html = '<li>' +
                        '<input type="checkbox" class="navCheck" id="' + id + '" ' + checked + ' />' +
                        '<label for="' + id + '">' +
                            span +
                        '</label>' +
                        '<ul>' + childrenHtml + "</ul>" +
                    '</li>';
        }
        else {
            html = '<li>' +
                         span +
                 '</li>';
        }
        return html;
    }


    function TextEdit(minChar, limChar, text) {
        this.minChar = minChar;
        this.limChar = limChar;
        this.text = text;
    }

    //sync LanguageService content and ace editor content
    function syncTypeScriptServiceContent(script, aceChangeEvent) {

        var data = aceChangeEvent;
        var action = data.action;
        var start = aceEditorPosition.getPositionChars(data.start);

        if (action == "insert") {

            var text = data.lines.map(function (line) {
                return line + '\n'; //TODO newline hard code
            }).join('');
            editLanguageService(script, new TextEdit(start, start, text));
        } else if (action == "remove") {
            var len = aceEditorPosition.getLinesChars(data.lines);
            var end = start + len;
            editLanguageService(script, new TextEdit(start, end, ""));
        }
    };


    function editLanguageService(name, textEdit) {
        typeScriptLS.editScript(name + ".ts", textEdit.minChar, textEdit.limChar, textEdit.text);
    }

    var deferredShowOccurrences = deferredCall(showOccurrences);

    function onChangeCursor(e) {
        if (!syncStop) {
            try {
                deferredShowOccurrences.schedule(200);
            } catch (ex) {
                //TODO
            }
            updateNavItemFromPosition();
        }
    };


    function showOccurrences() {
        typeScriptLS.updateScript(selectFileName + ".ts", editor.getSession().getDocument().getValue(), false);
        var references = languageService.getOccurrencesAtPosition(selectFileName + ".ts", aceEditorPosition.getCurrentCharPosition());
        var session = editor.getSession();
        refMarkers.forEach(function (id) {
            session.removeMarker(id);
        });
        if (typeof references === "undefined" || references == null)
            return;

        references.forEach(function (ref) {
            if (ref.fileName == selectFileName + ".ts") {
                var getpos = aceEditorPosition.getAcePositionFromChars;
                var start = getpos(ref.textSpan.start);
                var end = getpos(ref.textSpan.start + ref.textSpan.length);
                var range = new AceRange(start.row, start.column, end.row, end.column);
                refMarkers.push(session.addMarker(range, "typescript-ref", "text", true));
            }
        });
    }


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


    function formatCSS() {
        var css = beautifyCSS.css_beautify(editorCSS.getSession().getDocument().getValue(), { indent_size: INDENT_SIZE });
        editorCSS.getSession().getDocument().setValue(css);
    }

    function formatHTML() {
        var html = beautifyHTML.html_beautify(editorHTML.getSession().getDocument().getValue(), { indent_size: INDENT_SIZE });
        editorHTML.getSession().getDocument().setValue(html);
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
            IndentSize: INDENT_SIZE,
            TabSize: INDENT_SIZE,
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
            doNewGotoDefinitionStep(definitionInfo.textSpan.start);
        }
    }

    function doNewGotoDefinitionStep(start) {
        previousCursorPositionStack.push(editor.getCursorPosition());
        var startPos = editor.getSession().getDocument().indexToPosition(start);
        editor.gotoLine(startPos.row + 1, startPos.col, true);
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
        initializeControls();
        setTheme("light");
    });

    function initializeControls() {
        appFileService = new FileService($);

        editorHTML = ace.edit("editorHTML");
        editorHTML.getSession().setMode('ace/mode/html');
        editorHTML.setOptions({
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: false,
            enableSnippets: true
        });

        editorCSS = ace.edit("editorCSS");
        editorCSS.getSession().setMode('ace/mode/css');
        editorCSS.setOptions({
            enableBasicAutocompletion: true,
            enableLiveAutocompletion: false,
            enableSnippets: true
        });

        editor = ace.edit("editorTypescript");
        editor.getSession().setMode('ace/mode/typescript');
        editor.setOptions({
            enableSnippets: true
        });
        editorJavascript = ace.edit("editorJavascript");
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

        initEditorShortcuts();

        aceEditorPosition = new EditorPosition(editor);
        var typeCompilationService = new CompilationService(editor, languageService);
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

        $(".libLink").click(function (ev) {
            insertLibraryReferenceIfNotPresent($(this).attr("data-js"), $(this).attr("data-css"), $(this).attr("data-ts"));
            ev.preventDefault();
            return true;
        });

        $("#errorsTypescript").click(function (ev) {
            var lines = $("#errorsTypescript").attr("data-lines").split(',');
            var curIdx = parseInt($("#errorsTypescript").attr("data-curidx"));

            editor.gotoLine(parseInt(lines[curIdx]) + 1, 0, true);
            curIdx++;
            curIdx = curIdx % lines.length;
            $("#errorsTypescript").attr("data-curidx", curIdx);
        });

        $("#lnkToggleTheme").click(function (ev) {
            if ($(document.body).hasClass("dark"))
                setTheme("light");
            else
                setTheme("dark");
            ev.preventDefault();
            return true;
        });

        $(".toggle-navigationTree").click(function (ev) {
            if($(".typescript-navigation").is(":visible")) {
                $(".typescript-navigation").hide();
                $(".typescript-navigation").parent().find(".editor-container").css("width", "99%");
                $(".toggle-navigationTree").find("i").attr("class", "icon-chevron-right");
            }
            else {
                $(".typescript-navigation").show();
                $(".typescript-navigation").parent().find(".editor-container").css("width", "80%");
                $(".toggle-navigationTree").find("i").attr("class", "icon-chevron-left");
            }
                
            
            return true;
        })

        $(".typescript-navigation").on("click", ".navItem.leaf", function (ev) {
            doNewGotoDefinitionStep(parseInt($(this).attr("data-start")));
        });

        updateSideBySide();
    }

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

    function initEditorShortcuts() {
        editor.commands.addCommands([{
            name: "autoComplete",
            bindKey: "Ctrl-Space",
            exec: function (ed) {
                if (autoComplete.isActive() == false) {
                    typeScriptLS.updateScript(selectFileName + ".ts", editor.getSession().getDocument().getValue(), false);
                    autoComplete.setScriptName(selectFileName);
                    autoComplete.active();
                }
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

        editorHTML.commands.addCommands([{
            name: "formatHTML",
            bindKey: "Ctrl-D",
            exec: function (editor) {
                formatHTML();
            }
        }]);

        editorCSS.commands.addCommands([{
            name: "formatCSS",
            bindKey: "Ctrl-D",
            exec: function (editor) {
                formatCSS();
            }
        }]);
    }

    function setTheme(theme) {
        var editorTheme;
        if (theme == "dark") {
            editorTheme = "ace/theme/tomorrow_night";
            $(document.body).addClass("dark");
            $("#cssBootstrap").attr("href", "stylesheets/bootstrap-dark.css");
        }
        else {
            editorTheme = "ace/theme/github";
            $(document.body).removeClass("dark");
            $("#cssBootstrap").attr("href", "stylesheets/bootstrap.css");
        }

        editorHTML.setTheme(editorTheme);
        editorCSS.setTheme(editorTheme);
        editor.setTheme(editorTheme);
        editorJavascript.setTheme(editorTheme);
    }

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

    function isDirty() {
        if (!editor.session.getUndoManager().isClean() ||
            !editorHTML.session.getUndoManager().isClean() ||
            !editorCSS.session.getUndoManager().isClean()) {
            return true;
        }
        else
            return false;
    }


    /*
        All logic for the output pane/external window
    */

    var consoleLogBuffer = [];
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

        runProcessConsoleBuffer();
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
        consoleLogBuffer.push(message);
    }

    function clearConsoleLog() {
        $("#txtConsole").empty();
    }

    function runProcessConsoleBuffer() {
        if (consoleLogBuffer.length > 0) {

            var items = consoleLogBuffer.slice();
            consoleLogBuffer = [];

            var logger = $("#txtConsole").get(0);
            var completeHtml = logger.innerHTML;

            for (var i = 0; i < items.length; i++) {
                var message = items[i];
                var html;
                if (typeof message == 'object')
                    html = (JSON && JSON.stringify ? JSON.stringify(message) : message);
                else
                    html = message;

                completeHtml += "<div class='console-entry'>" + html + "</div>";
            }

            logger.innerHTML = completeHtml;
            logger.scrollTop = logger.scrollHeight;

            var nrOfItems = $("#txtConsole").children().length;
            if (nrOfItems > 100) {
                var nrToRemove = nrOfItems - 100;
                $("#txtConsole").find(".console-entry:lt(" + nrToRemove + ")").remove();
            }
        }
        window.setTimeout(runProcessConsoleBuffer, 100);
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
                text: errorMsg + jsStacktrace,
                minChar: range.end.row,
                limChar: range.end.column,
                type: "error",
                raw: errorMsg + jsStacktrace,
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

    function getOutputHTML(includeJavascript, includeTypescript) {
        var htmlText = editorHTML.getValue();
        var javascriptText = "<script>" + editorJavascript.getValue() + "</script>";
        var cssText = "<style>" + editorCSS.getValue() + "</style>";

        if (htmlText.indexOf("<!--%CSS%-->") == -1) // insert at the end of the head tag if %CSS% is not available
            htmlText = htmlText.replace("</head>", cssText + "\n" + "</head>");
        else
            htmlText = htmlText.replace("<!--%CSS%-->", cssText);

        if (includeJavascript) {
            var idx = htmlText.indexOf("<!--%Javascript%-->");
            if (idx != -1) {
                var nrOfLinesToJavascript = htmlText.substring(0, idx).split('\n').length;
                lineNumberOffsetOnPage = nrOfLinesToJavascript;
                htmlText = htmlText.replace("<!--%Javascript%-->", javascriptText);
            }
            else {
                idx = htmlText.indexOf("</body>"); // insert the javascript at the end of the html body
                if (idx != -1) {
                    var nrOfLinesToJavascript = htmlText.substring(0, idx).split('\n').length;
                    lineNumberOffsetOnPage = nrOfLinesToJavascript;
                    htmlText = htmlText.replace("</body>", javascriptText + "\n" + "</body>");
                }
            }

        }
        if (includeTypescript) {
            idx = htmlText.indexOf("</body>"); // insert the typescript at the end of the html body
            if (idx != -1) {
                var typescriptText = "<script id='_typescriptCode' type='text/typescript'> " + "\n" + editor.getSession().getValue() + "\n" + "</script>";
                htmlText = htmlText.replace("</body>", typescriptText + "\n" + "</body>");
            }
        }

        htmlText = htmlText.replace(/\r?\n/g, "\r\n"); // make sure \r\n for newlines so it's both readable on linux and windows
        return htmlText;
    }

    function resetOutputPaneTimer() {
        if (outputUpdateTimer != null)
            window.clearTimeout(outputUpdateTimer);
    }
    var outputUpdateTimer = null;
    function updateOutputPane() {
        resetOutputPaneTimer();
        outputUpdateTimer = window.setTimeout(function () {
            if ($("#tab-output").is(":visible")) {
                var htmlText = getOutputHTML($("#chkRunJavascript").hasClass("active"));

                var jiframe = $("<iframe class='outputframe' id='outputIFrame'></iframe>");
                $("#outputFrame").append(jiframe);

                $("#outputIFrame").empty().detach();
                var iframe = jiframe.get(0);
                resetWindow(iframe.contentWindow, htmlText);
            }

            updateExternalWindow();
        }, 500);
    }






    /* 
        Business logic to start from a new document, load, save and create a milestone.
        All the REST interactions are grouped together in the RestServices class.
    */



    var restService = new LocalRestServices();

    var ignoreHash = false;
    var oldHash;
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
            else {
                // revert hash
                setHash(oldHash);
            }
        }
        oldHash = newHash;
    }

    function setHash(hash) {
        ignoreHash = true;
        window.location.hash = hash;
    }


    function confirmIfDirty() {
        if (isDirty()) {
            if (confirm("Recent changes are not saved, do you want to continue?"))
                return true;
            else
                return false;
        }
        else
            return true;
    }

    $(function () {
        // start from a new file
        if (location.hash == "")
            restService.newFile();
        else
            openFromHash(location.hash);

        $("#lnkNew").click(function (ev) {
            if (confirmIfDirty()) {
                restService.newFile();
            }

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
            saveFile();
            ev.preventDefault();
            return true;
        });

        $("#lnkCreateMilestone").click(function (ev) {
            $('#modalCreateMilestone').modal();
            ev.preventDefault();
            return true;
        });

        $("#lnkDownload").click(function (ev) {
            var html = getOutputHTML(true, true);
            var blob = new Blob([html], { type: "text/html;charset=utf-8" });
            saveAs(blob, selectFileName + "-" + selectMilestone + ".html");
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
        $(window).bind('beforeunload', function () {
            if (confirmIfDirty()) {
                return "Recent changes are not saved, do you want to continue?";
            }
        });

        // auto save each 5min
        var deferredAutosavecall;
        deferredAutosavecall = deferredCall(function () {
            if (isDirty())
                saveFile();
            deferredAutosavecall.schedule(5 * 60 * 1000);
        })
        deferredAutosavecall.schedule(5 * 60 * 1000);
    });

    function saveFile() {
        restService.saveFile(selectFileName, editorHTML.getValue(), editorCSS.getValue(), editor.getValue(), function onSucces() {
            editor.session.getUndoManager().markClean();
            editorHTML.session.getUndoManager().markClean();
            editorCSS.session.getUndoManager().markClean();
        });
    }

    function showNotification(msg, type) {
        if (type == "info") {
            $("#lblNotification").parent().attr("class", "notification alert alert-info")
        }
        else if (type == "warning") {
            $("#lblNotification").parent().attr("class", "notification alert alert-error")
        }
        else if (type == "error") {
            $("#lblNotification").parent().attr("class", "notification alert alert-error")
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

        function saveFile(name, html, css, typescript, onSuccess) {
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
                    onSuccess();
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
                    "        <h1>Hello</h1>\n" +
                    "        <!--%Javascript%-->\n" +
                    "    </body>\n" +
                    "</html>";
        }
        function getDefaultCSS() {
            return "body {\n" +
                   "\n" +
                   "}"
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

        function saveFile(name, html, css, typescript, onSuccess) {
            try {
                createEntryIfNotExists(name);
                var entries = loadObj("entries");
                var entry = entries[name];

                var milestone = entry.Milestones[entry.LastMilestone - 1];
                milestone.HTML = html;
                milestone.CSS = css;
                milestone.Typescript = typescript;
                saveObj("entries", entries);
                onSuccess();
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
