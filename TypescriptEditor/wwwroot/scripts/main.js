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
    var jsZip = require("lib/jszip");

    var myLayout;

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

    var libnames = [
        "typescripts/lib.d.ts",
        "typescripts/lib.es5.d.ts",
        "typescripts/lib.dom.d.ts",
        "typescripts/lib.webworker.importscripts.d.ts",
        "typescripts/lib.es2015.d.ts",
        "typescripts/lib.es2015.core.d.ts",
        "typescripts/lib.es2015.collection.d.ts",
        "typescripts/lib.es2015.generator.d.ts",
        "typescripts/lib.es2015.proxy.d.ts",
        "typescripts/lib.es2015.reflect.d.ts",
        "typescripts/lib.es2015.symbol.d.ts",
        "typescripts/lib.es2015.symbol.wellknown.d.ts",
        "typescripts/lib.es2015.promise.d.ts",
        "typescripts/lib.es2015.iterable.d.ts",
        "typescripts/lib.scripthost.d.ts",
        "typescripts/jquery.d.ts"
    ];

    function loadTypeScriptLibrary() {

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
        deferredShowTasks();
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
    var deferredFilterNavTree = deferredCall(filterNavTree);

    function onUpdateTypescriptDocument(e) {
        if (selectFileName) {
            if (!syncStop) {
                try {
                    syncTypeScriptServiceContent(selectFileName, e);


                } catch (ex) {
                }
                if ($(".typescript-navigation").is(":visible"))
                    deferredUpdateNavTree.schedule(1000);

                deferredShowTasks.schedule(1000);

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
        var checkedNavs = $(".navCheck:checked:visible");
        for (var i = 0; i < checkedNavs.length; i++)
            expandedItems[checkedNavs[i].id] = true;

        var rootNode = languageService.getNavigationTree(selectFileName + ".ts");

        var html = "";
        html += getNavigationListItemsFromNode(rootNode, rootNode.text, expandedItems, undefined, 0);

        $("#navTree").empty().html(html);

        // make global always expand
        $("#navTree li:first").children(".navCheck").prop("checked", true);

        var innerNodes = $("#navTree ul");
        for (var i = 0; i < innerNodes.length; i++) {
            var ul = $(innerNodes[i]);
            ul.children("li").sort(function (a, b) { return ($(b).data('start')) < ($(a).data('start')) ? 1 : -1; })
                .appendTo(ul);
        }

        // remove duplicate global functions
        var items = $("#navTree li:first").children("ul").children("li");
        if (items.length > 0) {
            var prevStart = $(items[0]).attr("data-start");
            var prevLength = $(items[0]).attr("data-length");

            for (var i = 1; i < items.length; i++) {
                var curStart = $(items[i]).attr("data-start");
                var curLength = $(items[i]).attr("data-length");

                if (prevStart == curStart && prevLength == curLength) {
                    $(items[i]).detach();
                }
                prevStart = curStart;
                prevLength = curLength;
            }
        }

        $("#navTreeSearch").html($("#navTree").html());
        $("#navTreeSearch .navCheck").prop("checked", true);

        updateNavItemFromPosition(true);
    }


    var _oldNavItemPos = -1;
    function updateNavItemFromPosition(forceUpdate) {
        var curPos = aceEditorPosition.getCurrentCharPosition();

        if (!forceUpdate && _oldNavItemPos == curPos)
            return;

        _oldNavItemPos = curPos;
        var navItems = $("#navTree .navItem");
        navItems.removeClass("selected");
        $("#navTree .navListItem").removeClass("selected");

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
        if (smallestLengthNavItem != null) {
            $(navItems[smallestLengthNavItem]).addClass("selected");

            // select all navItems on the path to the root as well
            var parentItems = $(navItems[smallestLengthNavItem]).parents(".navListItem");
            for (var i = 0; i < parentItems.length; i++) {
                $(parentItems[i]).children("label").children(".navItem").addClass("selected");
            }
        }
        //   else
        //       console.log("Nav tree item not found for current position");
    }

    function filterNavTree() {
        var searchString = $("#txtNavTreeFilter").val().toLowerCase();

        if (searchString == "") {
            $("#navTreeSearch").hide();
            $("#navTree").show();
            return;
        }
        else {
            $("#navTreeSearch").show();
            $("#navTree").hide();
        }

        $("#navTreeSearch li").hide();

        var items = $("#navTreeSearch .navItem");
        for (var i = 0; i < items.length; i++) {
            if ($(items[i]).text().toLowerCase().indexOf(searchString) != -1) {
                $(items[i]).parents("li").show();
            }
        }
    }

    function getNavigationListItemsFromNode(node, path, expandedItems, appendChildrenHtml, depth) {
        if (depth > 20) {
            // stop recursion to prevent hang
            return "";
        }

        var id = encodeURI(path + "." + node.text);

        var childrenHtml = "";

        if (typeof node.childItems !== "undefined") {
            for (var i = 0; i < node.childItems.length; i++) {
                childrenHtml += getNavigationListItemsFromNode(node.childItems[i], id, expandedItems, undefined, depth + 1);
            }
        }

        if (typeof appendChildrenHtml !== "undefined")
            childrenHtml += appendChildrenHtml;

        var kindVal = (node.kind + "").replace(" ", "-");
        var kind = "label-kind-" + kindVal;
        var text = node.text;

        var start = node.spans[0].start;
        var length = node.spans[0].length;

        var isLeaf = childrenHtml.length == 0;

        var modifiers = node.kindModifiers.split(',');
        var overlay = "";
        for (var i = 0; i < modifiers.length; i++) {
            overlay += '<span class="label-overlay ' + "label-modifier-" + modifiers[i] + '"></span>';
        }


        for (var i = 0; i < modifiers.length; i++) {

        }

        var span = '<span class="navItem ' + (isLeaf ? "leaf " : "") + kind + '" data-start="' + start + '" data-length="' + length + '">' + htmlEncode(text) + '</span>';
        var html;

        var checked = "";
        if (typeof expandedItems[id] !== "undefined")
            checked = "checked";

        var padding = node.indent * 20;
        if (childrenHtml.length > 0) {
            html = '<li class="navListItem" data-start="' + start + '" data-length="' + length + '">' +
                '<input type="checkbox" class="navCheck" id="' + id + '" ' + checked + ' />' +
                '<label for="' + id + '">' +
                span + overlay +
                '</label>' +
                '<ul>' + childrenHtml + "</ul>" +
                '</li>';
        }
        else {
            html = '<li class="navListItem leaf" data-start="' + start + '" data-length="' + length + '">' +
                '<input type="checkbox" class="navCheck" style="visbility:hidden" id="' + id + '" ' + checked + ' />' +
                '<label for="' + id + '">' +
                span + overlay +
                '</label>' +
                '<ul>' + "" + "</ul>" +
                '</li>';
        }
        return html;
    }

    function htmlEncode(html) {
        return document.createElement('a').appendChild(
            document.createTextNode(html)).parentNode.innerHTML;
    };

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
    var deferredShowSignatureHelperItems = deferredCall(showSignatureHelperItems);
    var deferredShowTasks = deferredCall(showTasks);
    function onChangeCursor(e) {
        if (!syncStop) {
            try {
                deferredShowOccurrences.schedule(200);
                deferredShowSignatureHelperItems.schedule(100);
            } catch (ex) {
                //TODO
            }
            updateNavItemFromPosition(false);
        }
    };

    function showTasks() {
        var todoItems = languageService.getTodoComments(selectFileName + ".ts", [{ text: "TODO" }]);

        $("#txtTasks").find(".task-entry").empty().detach();

        todoItems.forEach(function (t) {
            // t.message
            // t.position

            var pos = aceEditorPosition.getAcePositionFromChars(t.position);
            pos.row + 1

            var entry = $("<div class='task-entry' data-row='" + pos.row + "' data-col='" + pos.col + "'><div class='lineNr'>" + (pos.row + 1) + "</div><div class='task-content'></div></div>");
            $(entry).find(".task-content").text(t.message);
            $("#txtTasks").append(entry);
        });
    }

    function showSignatureHelperItems() {
        typeScriptLS.updateScript(selectFileName + ".ts", editor.getSession().getDocument().getValue(), false);
        var result = languageService.getSignatureHelpItems(selectFileName + ".ts", aceEditorPosition.getCurrentCharPosition());
        if (typeof result !== "undefined") {
            var items = result.items;
            var html = "";


            var prefixLength = 0;
            for (var i = 0; i < items.length; i++) {

                var row = "";

                var itemPrefixLength = 0;
                items[i].prefixDisplayParts.forEach(function (el) { row += el.text; itemPrefixLength += el.text.length; });
                if (prefixLength < itemPrefixLength)
                    prefixLength = itemPrefixLength;

                for (var p = 0; p < items[i].parameters.length; p++) {

                    if (p == result.argumentIndex)
                        row += "**BOLD**";
                    items[i].parameters[p].displayParts.forEach(function (el) { row += el.text });

                    if (p == result.argumentIndex)
                        row += "**/BOLD**";

                    if (p != items[i].parameters.length - 1)
                        items[i].separatorDisplayParts.forEach(function (el) { row += el.text });
                }
                items[i].suffixDisplayParts.forEach(function (el) { row += el.text });

                row = row.replace(/'/g, '&apos;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                row = row.replace("**BOLD**", "<span class='highlight'>");
                row = row.replace("**/BOLD**", "</span>");

                html += "<div class='quickinfo-row'>" + row + "</div>";
            }
            $("#quickInfo").html(html);

            var pos = aceEditorPosition.getAcePositionFromChars(result.applicableSpan.start - prefixLength);
            var posWithoutPrefix = aceEditorPosition.getAcePositionFromChars(result.applicableSpan.start);
            if (pos.row < posWithoutPrefix.row) {
                // removing the prefix of the function causes the position to jump back one row
                // this happens when generics are implicitely used, for example .toDictionary(|... will have a prefix .toDictionary<Key,Value> 
                // which isn't present in the actual code and will wrap too far
                pos.row = posWithoutPrefix.row;
                pos.column = 0;
            }
            var coords = editor.renderer.textToScreenCoordinates(pos.row, pos.column);


            var quickInfoParentOffset = $("#quickInfo").parent().offset();
            var quickInfoParentHeight = $("#quickInfo").parent().height();

            var quickInfoTop = Math.max(coords.pageY + 20, 0) - quickInfoParentOffset.top;
            var quickInfoHeight = $("#quickInfo").height();
            // check if it covers the cursor
            // and move it down if it does

            var cursorPos = editor.getCursorPosition();
            var cursorCoords = editor.renderer.textToScreenCoordinates(cursorPos.row, cursorPos.column);
            var cursorY = cursorCoords.pageY - quickInfoParentOffset.top;
            if (cursorY + 20 > quickInfoTop) {
                // the row where the cursor is on falls below the quick info
                quickInfoTop = cursorY + 20; // move it below the cursor
            }
            // check if it falls off the bottom
            // move it above the line then
            if (quickInfoTop + quickInfoHeight > quickInfoParentHeight) {
                // move it above the line
                quickInfoTop = Math.max(coords.pageY, 0) - quickInfoParentOffset.top - quickInfoHeight;
            }

            $("#quickInfo").css({
                position: "absolute",
                zIndex: 999, // autocomplete is 1000
                left: Math.max(coords.pageX, 0) - quickInfoParentOffset.left,
                top: quickInfoTop
            });
            $("#quickInfo").show();
        }
        else {
            $("#quickInfo").empty();
            $("#quickInfo").hide();
        }
    }

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

    function getTypescriptContextMenu() {

        var fixes = [];
        var curPos = aceEditorPosition.getCurrentCharPosition();
        var annotations = editor.getSession().getAnnotations();
        for (var i = 0; i < annotations.length; i++) {
            var start = annotations[i].minChar;
            var end = annotations[i].limChar;
            var code = annotations[i].code;

            if (curPos >= start && curPos < start + end && typeof code !== "undefined") {
                var formatSettings = typeScriptLS.getFormatCodeSettings();
                var codeFixes = languageService.getCodeFixesAtPosition(selectFileName + ".ts", start, end, [code], formatSettings);
                if (codeFixes.length > 0) {

                    for (var j = 0; j < codeFixes.length; j++) {
                        fixes.push(codeFixes[j]);
                    }
                }
            }
        }


        var selectionRange = editor.getSelectionRange();
        var startPos = aceEditorPosition.getChars(editor.session.doc, selectionRange.start);
        var endPos = aceEditorPosition.getChars(editor.session.doc, selectionRange.end);

        var refactorOptions = languageService.getApplicableRefactors(selectFileName + ".ts", {
            pos: startPos,
            end: endPos
        });


        var items = {};

        var cnt = 0;
        if (fixes.length > 0) {
            for (var i = 0; i < fixes.length; i++) {
                items["item" + cnt] = {
                    name: fixes[i].description,
                    codefix: fixes[i],
                    sourceType: "codefix"
                };
                cnt++;
            }
        }

        if (refactorOptions.length > 0) {
            for (var i = 0; i < refactorOptions.length; i++) {

                for (var j = 0; j < refactorOptions[i].actions.length; j++) {
                    items["item" + cnt] = {
                        name: refactorOptions[i].actions[j].description,
                        refactor: {
                            refactorName: refactorOptions[i].name,
                            actionName: refactorOptions[i].actions[j].name
                        },
                        sourceType: "refactor"
                    };
                    cnt++;
                }
                
            }
        }

        return {
            callback: function (key, options) {

                if (items[key].sourceType == "codefix")
                    applyCodeFixWith(items[key].codefix);
                else if (items[key].sourceType == "refactor") {
                    applyRefactorWith(items[key].refactor, startPos, endPos);
                }
            },
            items: items
        };
    }



    function applyCodeFixWith(codeFix) {
        // sort by start position ? // TODO
        var minmaxEditCharPos = {
            min: Number.MAX_VALUE,
            max: Number.MIN_VALUE
        };

        for (var i = 0; i < codeFix.changes.length; i++) {

            var change = codeFix.changes[i];
            applyTextChange(change, minmaxEditCharPos);
        }
        formatDocumentRange(minmaxEditCharPos.min, minmaxEditCharPos.max);
    }

    function applyRefactorWith(refactorData, startPos, endPos) {

        var editInfo = languageService.getEditsForRefactor(selectFileName + ".ts", defaultFormatCodeOptions(), {
            pos: startPos,
            end: endPos
        }, refactorData.refactorName, refactorData.actionName);

        var minmaxEditCharPos = {
            min: Number.MAX_VALUE,
            max: Number.MIN_VALUE
        };

        for (var i = 0; i < editInfo.edits.length; i++) {

            var change = editInfo.edits[i];
            applyTextChange(change, minmaxEditCharPos);
        }
        formatDocumentRange(minmaxEditCharPos.min, minmaxEditCharPos.max);
    }

    function applyTextChange(change, minmaxEditCharPos) {

        for (var j = change.textChanges.length - 1; j >= 0; j--) {

            if (change.textChanges[j].span.length == 0) {
                // insert
                var pos = aceEditorPosition.getAcePositionFromChars(change.textChanges[j].span.start);
                editor.getSession().getDocument().insert(pos, change.textChanges[j].newText);
            }
            else {
                // replace
                var start = aceEditorPosition.getAcePositionFromChars(change.textChanges[j].span.start);
                var end = aceEditorPosition.getAcePositionFromChars(change.textChanges[j].span.start + change.textChanges[j].span.length);
                var range = new AceRange(start.row, start.column, end.row, end.column);
                editor.session.replace(range, change.textChanges[j].newText);
            }

            if (minmaxEditCharPos.min > change.textChanges[j].span.start) minmaxEditCharPos.min = change.textChanges[j].span.start;
            if (minmaxEditCharPos.max < change.textChanges[j].span.start) minmaxEditCharPos.max = change.textChanges[j].span.start;

            if (minmaxEditCharPos.min > change.textChanges[j].span.start + Math.min(change.textChanges[j].span.length, change.textChanges[j].newText.length)) minmaxEditCharPos.min = change.textChanges[j].span.start + Math.min(change.textChanges[j].span.length, change.textChanges[j].newText.length);
            if (minmaxEditCharPos.max < change.textChanges[j].span.start + Math.max(change.textChanges[j].span.length, change.textChanges[j].newText.length)) minmaxEditCharPos.max = change.textChanges[j].span.start + Math.max(change.textChanges[j].span.length, change.textChanges[j].newText.length);
        }
    }

    function formatDocumentRange(minEditCharPos, maxEditCharPos) {
        var textChanges = languageService.getFormattingEditsForRange(selectFileName + ".ts", minEditCharPos, maxEditCharPos, defaultFormatCodeOptions());
        for (var i = textChanges.length - 1; i >= 0; i--) {

            var textChange = textChanges[i];

            var startPos = editor.getSession().getDocument().indexToPosition(textChange.span.start);
            var endPos = editor.getSession().getDocument().indexToPosition(textChange.span.start + textChange.span.length);
            var range = new AceRange(startPos.row, startPos.column, endPos.row, endPos.column);
            editor.getSession().getDocument().replace(range, textChange.newText);
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
            libnames.forEach(function (libname) {
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

        //$(".tab").click(function (e) {
        //    //var id = $(this).attr("data-target");
        //    //var el = document.getElementById(id);
        //    $(this).toggleClass("active");
        //    //if ($(this).hasClass("active"))
        //    //    $(el).show();
        //    //else
        //    //    $(el).hide();

        //    updateSideBySide();
        //});

        //$(".tab[data-target=tab-output]").click(function (e) {
        //    updateOutputPane();
        //});

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
        $(document).on("click", ".error-entry", function (ev) {
            var line = parseInt($(this).attr("data-line"));
            editor.gotoLine(line + 1, 0, true);
        });

        $(document).on("click", ".task-entry", function (ev) {
            var row = parseInt($(this).attr("data-row"));
            var col = parseInt($(this).attr("data-col"));
            editor.gotoLine(row + 1, col, true);
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
            if ($(".typescript-navigation").is(":visible")) {
                $(".typescript-editorcontainer").removeClass("pad-left");
                $(".typescript-navigation").hide();
                $(".typescript-navigation").parent().find(".editor-container").css("width", "99%");
                $(".toggle-navigationTree").find("i").attr("class", "icon-chevron-right");
            }
            else {
                $(".typescript-editorcontainer").addClass("pad-left");
                $(".typescript-navigation").show();
                $(".typescript-navigation").parent().find(".editor-container").css("width", "80%");
                $(".toggle-navigationTree").find("i").attr("class", "icon-chevron-left");
                deferredUpdateNavTree.schedule();
            }
            return true;
        })

        $(".typescript-navigation").on("click", ".navItem", function (ev) {
            if (!$(this).hasClass(".leaf")) {
                var chkId = $(this).parent().attr("for");
                var chk = $(document.getElementById(chkId));
                chk.prop("checked", !chk.prop("checked"));
            }
            doNewGotoDefinitionStep(parseInt($(this).attr("data-start")));
        });

        $("#txtNavTreeFilter").keyup(function (ev) {
            deferredFilterNavTree.schedule(200);
        });

        $("#btnExpandAllNavTree").click(function () {
            if ($("#txtNavTreeFilter").val() == "")
                $("#navTree .navCheck").prop("checked", true);
            else
                $("#navTreeSearch .navCheck").prop("checked", true);
        });

        $("#btnCollapseAllNavTree").click(function () {
            if ($("#txtNavTreeFilter").val() == "")
                $("#navTree .navCheck").prop("checked", false);
            else
                $("#navTreeSearch .navCheck").prop("checked", false);
        });

        $("#lnkResetLayoutToDefault").click(function (ev) {

            if (window.localStorage) {
                localStorage.removeItem('_layoutSavedState');
            }

            // return everything to element parking
            $("#elementParking").append($("#editorHTML"));
            $("#elementParking").append($("#editorCSS"));
            $("#elementParking").append($("#typescriptContainer"));
            $("#elementParking").append($("#editorJavascript"));
            $("#elementParking").append($("#outputFrame"));
            $("#elementParking").append($("#consoleContainer"));
            $("#elementParking").append($("#txtErrors"));
            $("#elementParking").append($("#navigationTree"));
            $("#elementParking").append($("#taskContainer"));

            $('#goldenLayoutContainer').empty();

            initializeLayout();

            ev.preventDefault();
            return true;
        });


        var contextMenuShown = false;
        $.contextMenu({
            selector: '#editorTypescript',
            build: function ($trigger, e) {
                // this callback is executed every time the menu is to be shown
                // its results are destroyed every time the menu is hidden
                // e is the original contextmenu event, containing e.pageX and e.pageY (amongst other data)
                return getTypescriptContextMenu();
            },
            position: function (opt, x, y) {
                var cursorPos = editor.getCursorPosition();
                var cursorCoords = editor.renderer.textToScreenCoordinates(cursorPos.row, cursorPos.column);

                opt.$menu.css({ top: cursorCoords.pageY, left: cursorCoords.pageX });
            },
            events: {
                show: function (options) {
                    contextMenuShown = true;
                    window.setTimeout(function () {
                        options.$menu.trigger("nextcommand");
                    }, 10);
                },
                hide: function (options) {
                    contextMenuShown = false;
                }
            }
        });

        editor.keyBinding.origOnCommandKey = editor.keyBinding.onCommandKey;
        editor.keyBinding.onCommandKey = function (e, hashId, keyCode) {
            if (!contextMenuShown) {
                this.origOnCommandKey(e, hashId, keyCode);
            }
        };

        editor.keyBinding.origOnTextInput = editor.keyBinding.onTextInput;
        editor.keyBinding.onTextInput = function (text) {
            if (!contextMenuShown) {
                this.origOnTextInput(text);
            }
        };

        filterNavTree();

        initializeLayout();
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

    function setCompilerOptions(compilerOptions) {
        var params = {
            data: {
                compilerOptions: JSON.stringify(compilerOptions),
            }
        };
        editor.getSession().$worker.emit("setCompilerOptions", params);
        typeScriptLS.setCompilerOptions(compilerOptions);
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


        // for azerty
        editor.commands.addCommands([{
            name: "applyCodeFix",
            bindKey: "Ctrl-;",
            exec: function (editor) {
                $("#editorTypescript").trigger("contextmenu");
            }
        }]);
        // for qwerty
        editor.commands.addCommands([{
            name: "applyCodeFix",
            bindKey: "Ctrl-.",
            exec: function (editor) {
                $("#editorTypescript").trigger("contextmenu");
            }
        }]);


        editor.commands.addCommands([{
            name: "hideQuickInfo",
            bindKey: "Esc",
            exec: function (editor) {
                $("#quickInfo").empty().hide();
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
            $("#goldenLayoutTheme").attr("href", "stylesheets/goldenlayout-dark-theme.css");
        }
        else {
            editorTheme = "ace/theme/github";
            $(document.body).removeClass("dark");
            $("#cssBootstrap").attr("href", "stylesheets/bootstrap.css");
            $("#goldenLayoutTheme").attr("href", "stylesheets/goldenlayout-light-theme.css");
        }

        editorHTML.setTheme(editorTheme);
        editorCSS.setTheme(editorTheme);
        editor.setTheme(editorTheme);
        editorJavascript.setTheme(editorTheme);

        if (window.localStorage)
            window.localStorage.setItem('_theme', theme);
    }

    //function updateSideBySide() {

    //    $("#editorLayout").colResizable({
    //        disable: true,
    //    });


    //    var activeTabs = $(".tab.active");
    //    var perc = Math.floor(100 / activeTabs.length);
    //    for (var i = 0; i < activeTabs.length; i++) {

    //        var idx = $(activeTabs[i]).index();
    //        var el = document.getElementById($(activeTabs[i]).attr("data-target"));
    //        //    $(el).css("width", perc + "%");

    //        $("#editorLayout > tbody > tr:nth-child(1) > th:nth-child(" + (idx + 1) + ")").css("width", perc + "%");
    //        //$(el).show();

    //        $("#editorLayout > tbody > tr:nth-child(1) > th:nth-child(" + (idx + 1) + ")").show();
    //        $("#editorLayout > tbody > tr:nth-child(2) > td:nth-child(" + (idx + 1) + ")").show();
    //    }

    //    $("#editorLayout .lastvisible").removeClass("lastvisible");
    //    var lastActiveElementIndex = $(".tab.active:last").index();
    //    $("#editorLayout > tbody > tr:nth-child(2) > td:nth-child(" + (lastActiveElementIndex + 1) + ")").addClass("lastvisible");

    //    var tabs = $(".tab");
    //    for (var i = 0; i < tabs.length; i++) {
    //        if (!$(tabs[i]).hasClass("active")) {

    //            $("#editorLayout > tbody > tr:nth-child(1) > th:nth-child(" + (i + 1) + ")").hide();
    //            $("#editorLayout > tbody > tr:nth-child(2) > td:nth-child(" + (i + 1) + ")").hide();
    //            //var el = document.getElementById($(tabs[i]).attr("data-target"));
    //            //$(el).hide();
    //        }
    //    }

    //    initiateResizablePanes();

    //    window.setTimeout(function () {
    //        editorHTML.resize();
    //        editorCSS.resize();
    //        editor.resize();
    //        editorJavascript.resize();
    //    }, 25);
    //}

    //function initiateResizablePanes() {
    //    $("#editorLayout").colResizable({
    //        liveDrag: true,
    //        draggingClass: "dragging",
    //        onDrag: function (e) {
    //            $("#outputFrame").hide(); // necessary otherwise the iframe will steal the mouse release event, breaking the resizing
    //        },
    //        onResize: function (e) {
    //            $("#outputFrame").show();

    //            // make sure to resize ace if needed
    //            editorHTML.resize();
    //            editorCSS.resize();
    //            editor.resize();
    //            editorJavascript.resize();
    //        }
    //    });
    //}

    function initializeLayout() {
        var componentHTMLDef = {
            type: 'component',
            id: 'componentHTML',
            componentName: 'componentHTML',
            title: 'HTML',
            componentState: { text: 'HTML' }
        };
        var componentCSSDef = {
            type: 'component',
            id: 'componentCSS',
            componentName: 'componentCSS',
            title: 'CSS',
            componentState: { text: 'CSS' }
        };
        var componentTypescriptDef = {
            type: 'component',
            id: 'componentTypescript',
            componentName: 'componentTypescript',
            title: 'Typescript',
            componentState: { text: 'Typescript' }
        };
        var componentJavascriptDef = {
            type: 'component',
            id: 'componentJavascript',
            componentName: 'componentJavascript',
            title: 'Javascript',
            componentState: { text: 'Javascript' }
        };
        var componentOutputDef = {
            type: 'component',
            id: 'componentOutput',
            componentName: 'componentOutput',
            title: 'Output',
            componentState: { label: 'Output' }
        };
        var componentConsoleDef = {
            type: 'component',
            id: 'componentConsole',
            componentName: 'componentConsole',
            title: 'Console',
            componentState: { label: 'Console' }
        };
        var componentErrorsDef = {
            type: 'component',
            id: 'componentErrors',
            componentName: 'componentErrors',
            title: 'Errors',
            componentState: { label: 'Errors' }
        };
        var componentTasksDef = {
            type: 'component',
            id: 'componentTasks',
            componentName: 'componentTasks',
            title: 'Tasks',
            componentState: { label: 'Tasks' }
        };
        var componentNavigationTreeDef = {
            type: 'component',
            id: 'componentNavigationTree',
            componentName: 'componentNavigationTree',
            title: 'Overview',
            componentState: { label: 'Overview' }
        };

        var defaultConfig = {
            settings: {
                hasHeaders: true,
                constrainDragToContainer: true,
                reorderEnabled: true,
                selectionEnabled: false,
                showPopoutIcon: false,
                showMaximiseIcon: true,
                showCloseIcon: true
            },
            content: [{
                type: 'row',
                content: [
                    {
                        type: 'column',
                        width: 20,
                        content: [
                            componentNavigationTreeDef,
                        ]
                    },
                    {
                        type: 'stack',
                        id: 'mainstack',
                        isClosable: false,
                        width: 50,
                        content: [
                            componentHTMLDef,
                            componentCSSDef,
                            componentTypescriptDef,
                            componentJavascriptDef
                        ]
                    },
                    {
                        type: 'column',
                        width: 30,
                        content: [
                            componentOutputDef,
                            {
                                type: 'stack',
                                content: [
                                    componentErrorsDef,
                                    componentConsoleDef,
                                    componentTasksDef,
                                ]
                            }
                        ]
                    }
                ]
            }]
        };

        var config;
        if (window.localStorage) {
            var savedState = localStorage.getItem('_layoutSavedState');
            if (savedState != null)
                config = JSON.parse(savedState);
            else
                config = defaultConfig;
        }
        else
            config = defaultConfig;


        myLayout = new GoldenLayout(config, $('#goldenLayoutContainer'));
        myLayout.registerComponent('componentHTML', function (container, componentState) {
            container.getElement().append($("#editorHTML"));
            container.on("destroy", function (ev) { // return to parking
                $("#elementParking").append($("#editorHTML"));
            });
        });
        myLayout.registerComponent('componentCSS', function (container, componentState) {
            container.getElement().append($("#editorCSS"));
            container.on("destroy", function (ev) { // return to parking
                $("#elementParking").append($("#editorCSS"));
            });
        });
        myLayout.registerComponent('componentTypescript', function (container, componentState) {
            container.getElement().append($("#typescriptContainer"));
            container.on("destroy", function (ev) { // return to parking
                $("#elementParking").append($("#editorTypescript"));
            });
        });
        myLayout.registerComponent('componentJavascript', function (container, componentState) {
            container.getElement().append($("#editorJavascript"));
            container.on("destroy", function (ev) { // return to parking
                $("#elementParking").append($("#editorJavascript"));
            });
        });
        myLayout.registerComponent('componentOutput', function (container, componentState) {
            container.getElement().append($("#outputFrame"));
            container.on("destroy", function (ev) { // return to parking
                $("#elementParking").append($("#outputFrame"));
            });
        });
        myLayout.registerComponent('componentConsole', function (container, componentState) {
            container.getElement().append($("#consoleContainer"));
            container.on("destroy", function (ev) { // return to parking
                $("#elementParking").append($("#consoleContainer"));
            });
        });
        myLayout.registerComponent('componentErrors', function (container, componentState) {
            container.getElement().append($("#txtErrors"));
            container.on("destroy", function (ev) { // return to parking
                $("#elementParking").append($("#txtErrors"));
            });
        });
        myLayout.registerComponent('componentTasks', function (container, componentState) {
            container.getElement().append($("#taskContainer"));
            container.on("destroy", function (ev) { // return to parking
                $("#elementParking").append($("#taskContainer"));
            });
        });

        myLayout.registerComponent('componentNavigationTree', function (container, componentState) {
            container.getElement().append($("#navigationTree"));
            container.on("destroy", function (ev) { // return to parking
                $("#elementParking").append($("#navigationTree"));
            });
        });

        myLayout.on("stateChanged", function (ev) {
            editorHTML.resize();
            editorCSS.resize();
            editor.resize();
            editorJavascript.resize();

            var state = JSON.stringify(myLayout.toConfig());
            if (window.localStorage)
                window.localStorage.setItem('_layoutSavedState', state);


        });


        myLayout.on('tabCreated', function (tab) {
            tab._dragListener.on('dragStart', function () {
                $("#outputFrame").hide(); // necessary otherwise the iframe will steal the mouse release event, breaking the resizing
            });

            tab._dragListener.on('dragStop', function () {
                $("#outputFrame").show(); // necessary otherwise the iframe will steal the mouse release event, breaking the resizing
            });
        });

        // custom events added to goldenlayout
        myLayout.on('splitterDragStart', function () {
            $("#outputFrame").hide(); // necessary otherwise the iframe will steal the mouse release event, breaking the resizing
        });
        myLayout.on('splitterDragStop', function () {
            $("#outputFrame").show(); // necessary otherwise the iframe will steal the mouse release event, breaking the resizing
        });


        myLayout.init();

        var scrollbars = $('.ace_scrollbar')
            .css('overflow', 'hidden');


        var scrollbarSettings = { suppressScrollX: false, includePadding: true, minScrollbarLength: 12 };
        scrollbars.filter('.ace_scrollbar-v').perfectScrollbar(scrollbarSettings);
        scrollbars.filter('.ace_scrollbar-h').perfectScrollbar(scrollbarSettings);
        $("#navigationTree").perfectScrollbar(scrollbarSettings);
        $("#txtErrors").perfectScrollbar(scrollbarSettings);
        $("#txtConsole").perfectScrollbar(scrollbarSettings);
        $("#txtTasks").perfectScrollbar(scrollbarSettings);

        var editors = [editor, editorCSS, editorHTML, editorJavascript];
        for (var i = 0; i < editors.length; i++) {
            var e = editors[i];
            e.$blockScrolling = Infinity;
            var container = e.renderer.getContainerElement();
            $(e).hover(
                function () { scrollbars.addClass('hover'); },
                function () { scrollbars.removeClass('hover'); }
            );
            var session = e.getSession();
            session.on('change', function () {
                scrollbars.perfectScrollbar('update');
            });
        }
        $(window).resize(function () {
            myLayout.updateSize($(window).width() - 6, myLayout.container.height() - 6);
            scrollbars.perfectScrollbar('update');
        });



        $("#lnkViewHTML").click(function (ev) {
            if (myLayout.root.getItemsById("componentHTML").length == 0) {
                myLayout.root.getItemsById("mainstack")[0].addChild(componentHTMLDef);
            }
            ev.preventDefault();
            return true;
        });

        $("#lnkViewCSS").click(function (ev) {
            if (myLayout.root.getItemsById("componentCSS").length == 0) {
                myLayout.root.getItemsById("mainstack")[0].addChild(componentCSSDef);
            }
            ev.preventDefault();
            return true;
        });

        $("#lnkViewTypescript").click(function (ev) {
            if (myLayout.root.getItemsById("componentTypescript").length == 0) {
                myLayout.root.getItemsById("mainstack")[0].addChild(componentTypescriptDef);
            }
            ev.preventDefault();
            return true;
        });

        $("#lnkViewJavascript").click(function (ev) {
            if (myLayout.root.getItemsById("componentJavascript").length == 0) {
                myLayout.root.getItemsById("mainstack")[0].addChild(componentJavascriptDef);
            }
            ev.preventDefault();
            return true;
        });
        $("#lnkViewOutput").click(function (ev) {
            if (myLayout.root.getItemsById("componentOutput").length == 0) {
                myLayout.root.getItemsById("mainstack")[0].addChild(componentOutputDef);
            }
            ev.preventDefault();
            return true;
        });
        $("#lnkViewConsole").click(function (ev) {
            if (myLayout.root.getItemsById("componentConsole").length == 0)
                myLayout.root.getItemsById("mainstack")[0].addChild(componentConsoleDef);
            ev.preventDefault();
            return true;
        });
        $("#lnkViewErrors").click(function (ev) {
            if (myLayout.root.getItemsById("componentErrors").length == 0)
                myLayout.root.getItemsById("mainstack")[0].addChild(componentErrorsDef);
            ev.preventDefault();
            return true;
        });
        $("#lnkViewTasks").click(function (ev) {
            if (myLayout.root.getItemsById("componentTasks").length == 0)
                myLayout.root.getItemsById("mainstack")[0].addChild(componentTasksDef);
            ev.preventDefault();
            return true;
        });

        $("#lnkViewNavigationTree").click(function (ev) {
            if (myLayout.root.getItemsById("componentNavigationTree").length == 0)
                myLayout.root.getItemsById("mainstack")[0].addChild(componentNavigationTreeDef);
            ev.preventDefault();
            return true;
        });


        myLayout.updateSize($(window).width() - 6, myLayout.container.height() - 6);
    }


    function updateErrors() {
        var annotations = editor.getSession().getAnnotations();

        $("#txtErrors").find(".error-entry").empty().detach();

        if (annotations.length > 0) {
            var lines = [];
            annotations.forEach(function (a) {
                lines.push(a.row);

                var entry = $("<div class='error-entry' data-line='" + a.row + "'><div class='lineNr'>" + a.row + "</div><div class='error-content'></div></div>");
                $(entry).find(".error-content").text(a.text);
                $("#txtErrors").append(entry);
            });

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

    var consoleWindowDirty = false;
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
        //clearConsoleLog();
        if (consoleWindowDirty)
            addConsoleLog("###### Resetting output window ######");

        consoleWindowDirty = false;

        wnd.console.log = function (message) {
            addConsoleLog(message, 0);
            consoleWindowDirty = true;
        }
        wnd.console.warn = function (message) {
            addConsoleLog(message, 1);
            consoleWindowDirty = true;
        }
        wnd.console.error = function (message) {
            addConsoleLog(message, 2);
            consoleWindowDirty = true;
        }
        wnd.console.table = function (message) {
            addConsoleLog(message, 3);
            consoleWindowDirty = true;
        }
        wnd.console.clear = function (message) {
            consoleLogBuffer = [];
            clearConsoleLog();
        }

        wnd.document.write(html);
        wnd.document.close();
    }

    function addConsoleLog(message, status) {

        var msg;
        if (typeof message == 'object') {
            try {
                if (JSON)
                    msg = JSON.parse(JSON.stringify(message));
                else
                    msg = message;
            } catch (e) {
                msg = message;
            }
        }
        else {
            msg = message;
        }

        consoleLogBuffer.push({ message: msg, status: status });
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

            // if it was longer than 100 items keep only the last 100
            if (items.length > 100)
                items = items.slice(items.length - 100, items.length);

            for (var i = 0; i < items.length; i++) {
                var message = items[i].message;
                var status = items[i].status;
                var html;

                if (status == 3) { // table
                    if (Object.prototype.toString.call(message) === '[object Array]') {
                        html = '<table><thead><th>(Index)</th><th>Value</th></tr></thead><tbody>';
                        for (var k = 0; k < message.length; k++) {
                            var msg = (message[k] && message[k].toString) ? message[k].toString() : message[k];
                            html += "<tr><td>" + k + "</td><td>" + msg + "</td></tr>";
                        }
                    }
                    else if (typeof message == 'object') {
                        html = '<table><thead><th>(Index)</th><th>Name</th><th>Value</th></tr></thead><tbody>';
                        var idx = 0;
                        for (var k in message) {
                            if (message.hasOwnProperty(k)) {
                                var msg = (message[k] && message[k].toString) ? message[k].toString() : message[k];
                                html += "<tr><td>" + idx + "</td><td>" + k + "</td><td>" + msg + "</td></tr>";
                                idx++;
                            }
                        }
                    }
                }
                else {
                    if (typeof message == 'object') {
                        try {
                            html = (JSON && JSON.stringify ? JSON.stringify(message) : message);
                        } catch (e) {
                            html = message;
                        }
                    }
                    else
                        html = message;
                }

                completeHtml += "<div class='console-entry status" + status + "'>" + html + "</div>";
            }

            logger.innerHTML = completeHtml;
            logger.scrollTop = logger.scrollHeight;

            var nrOfItems = $("#txtConsole").find(".console-entry").length;
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
            if (myLayout && myLayout.root.getItemsById("componentOutput").length > 0) {
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
    // use local storage if it's loaded from github.io
    var restService = window.location.host.indexOf("github") == -1 ? new RestServices() : new LocalRestServices();

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

        $("#lnkExportToProject").click(function (ev) {

            // create a index.html that references a main.css and main.js
            // change the source mapping at the end of the generated js to match the main.ts
            // change the <!-- %CSS% and js tags to their respective link and script src elements
            // create a main.ts 
            // create a main.js
            // create a main.css

            // scan for all typings used in the header of the ts, create a folder typings and add all the typing to seperate files there
            // change the references to the typings/ relative directory
            // scan for all scripts used in the html and create a folder libs and add all the js libraries there
            // change the scripts to the libs/ relative directory

            var zip = new jsZip();

            var htmlText = editorHTML.getValue();
            var cssText = editorCSS.getValue();
            var jsText = editorJavascript.getValue();
            var tsText = editor.getValue();

            var cssTag = "<link rel='stylesheet' href='main.css' />";
            if (htmlText.indexOf("<!--%CSS%-->") == -1) // insert at the end of the head tag if %CSS% is not available
                htmlText = htmlText.replace("</head>", cssTag + "\n" + "</head>");
            else
                htmlText = htmlText.replace("<!--%CSS%-->", cssTag);

            var jsTag = "<script src='main.js'></script>"
            var idx = htmlText.indexOf("<!--%Javascript%-->");
            if (idx != -1) {
                htmlText = htmlText.replace("<!--%Javascript%-->", jsTag);
            }
            else {
                idx = htmlText.indexOf("</body>"); // insert the javascript at the end of the html body
                if (idx != -1) {
                    htmlText = htmlText.replace("</body>", jsTag + "\n" + "</body>");
                }
            }

            var referenceTag = "/// <reference path=\"REPLACE_PATH\" />";
            var regex = new RegExp(escapeRegExp(referenceTag).replace("REPLACE_PATH", "(.*)"), "g");
            var match;
            var newrefs = [];
            while (match = regex.exec(tsText)) {

                var content = getRemoteFile(match[1]);
                var parts = match[1].split('/');;
                var name = parts[parts.length - 1].split('?')[0];

                newrefs.push("/// <reference path=\"typings/" + name + "\" />");
                zip.file("typings/" + name, content);
            }
            tsText = tsText.replace(regex, "");
            tsText = newrefs.join("\n") + "\n" + tsText;

            jsText = jsText.replace("//# sourceMappingURL=temp.js.map", "//# sourceMappingURL=main.js.map")

            zip.file("main.css", cssText);
            zip.file("main.js", jsText);
            zip.file("main.ts", tsText);
            zip.file("index.html", htmlText);

            var blob = zip.generate({ type: "blob" });
            saveAs(blob, selectFileName + "-" + selectMilestone + ".zip");

            ev.preventDefault();
            return true;
        });

        $("#lnkCreateGist").click(function (ev) {
            var data = {
                "description": $("#txtDescription").val(),
                "public": false,
                "files": {
                    "main.ts": {
                        "content": editor.getValue()
                    },
                    "main.css": {
                        "content": editorCSS.getValue()
                    },
                    "main.html": {
                        "content": editorHTML.getValue()
                    },
                    "demo.html": {
                        "content": getOutputHTML(true, false)
                    }
                }
            }
            $.post("https://api.github.com/gists", data, function (resp) {
                window.open(resp.html_url, "_blank");
            }).fail(function (xhr, textStatus, errorThrown) {
                alert("Unable to create gist: " + xhr.responseText);
            });
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

        $("#btnClearConsole").click(function (ev) {
            clearConsoleLog();
        });

        $("#lnkEditCompilerOptions").click(function (ev) {

            var compilerOptions = typeScriptLS.getCompilationSettings();
            var chks = $("#pnlCompilerOptions input");
            for (var i = 0; i < chks.length; i++) {
                var propName = $(chks[i]).attr("data-property");
                $(chks[i]).prop("checked", compilerOptions[propName]);
            }

            typeScriptLS.setCompilerOptions(compilerOptions);

            $('#modalCompilerOptions').modal();
            ev.preventDefault();
            return true;
        });

        $("#btnApplyCompilerOptions").click(function (ev) {
            $('#modalCompilerOptions').modal('hide');

            var compilerOptions = typeScriptLS.getCompilationSettings();
            var chks = $("#pnlCompilerOptions input");
            for (var i = 0; i < chks.length; i++) {
                var propName = $(chks[i]).attr("data-property");
                var val = $(chks[i]).prop("checked");
                compilerOptions[propName] = val;
            }
            setCompilerOptions(compilerOptions);
        });

        $(window).bind('keydown', function (event) {
            if ((event.ctrlKey && !event.altKey) || event.metaKey) {
                if (event.which == 17)
                    return;

                var char;
                if (event.which >= 96 && event.which <= 105) // numpad
                    char = event.which - 96;
                else
                    char = String.fromCharCode(event.which).toLowerCase();

                if (char == ';')
                    $("#editorTypescript").trigger("contextmenu"); // for some reason ace doesn't want to do ctrl-; in azerty :/
                else {
                    var elements = $("*[data-shortcut='ctrl+" + char + "']");
                    if (elements.length > 0) {
                        elements.click();
                        event.preventDefault();
                    }
                }
            }
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

    function getRemoteFile(remote_url) {
        var request = new XMLHttpRequest();
        request.open('GET', remote_url, false);
        request.send(null);
        if (request.status === 200) {
            return request.responseText;
        }
        else
            return null;
        return strReturn;
    }

    function saveFile() {
        restService.saveFile(selectFileName, selectMilestone, editorHTML.getValue(), editorCSS.getValue(), editor.getValue(), function onSucces() {
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
        var restBaseUrl = "api/repo/";

        function newFile() {
            $.post(restBaseUrl + "newFile", function (resp) {
                if (resp.success) {
                    //resp.Result.Name
                    loadInEditors(resp.result.name, resp.result.milestone, resp.result.html, resp.result.css, resp.result.typescript);
                    setHash(resp.result.name + "-" + resp.result.milestone);
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

            $.get(restBaseUrl + "loadFile", { file: file, milestone: milestone }, function (resp) {
                if (resp.success) {

                    loadInEditors(resp.result.name, resp.result.milestone, resp.result.html, resp.result.css, resp.result.typescript, resp.result.description);
                    setHash(resp.result.name + "-" + resp.result.milestone);
                    showNotification("Loaded " + resp.result.name + " successfully", "info");
                }
                else {
                    showNotification("Unable to load file", "error");
                }
            });
        }
        self.loadFile = loadFile;

        function listFiles() {
            $.get(restBaseUrl + "listFiles", function (resp) {
                if (resp.success) {
                    $("#lstFiles").empty();
                    var items = [];
                    for (var i = 0; i < resp.result.length; i++) {
                        items.push($("<li class='list-group-item item' data-name='" + resp.result[i].name + "'>" +
                            "<a href='#'>" +
                            resp.result[i].name +
                            "<span class='lnkDelete pull-right' data-name='" + resp.result[i].name + "'><i class='icon-remove'></i></span>" +
                            "<span class='badge pull-right'>" + resp.result[i].milestone + "</span>" +
                            "<span class='date pull-right'>" + resp.result[i].lastUpdated + "</span>" +
                            "<br/>" +
                            "<span class='description'>" + resp.result[i].description + "</span>" +
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

        function saveFile(name, milestone, html, css, typescript, onSuccess) {
            var file = {
                name: name,
                milestone:milestone,
                html: html,
                css: css,
                typescript: typescript,
                output: getOutputHTML(true)
            };
            $.post(restBaseUrl + "saveFile", file, function (resp) {
                if (resp.success) {
                    // show notification saved
                    showNotification("Saved successfully", "info");
                    onSuccess();
                }
                else {
                    showNotification("Unable to save, " + resp.message, "error");
                }
            }).fail(function () {
                showNotification("Unable to save", "error");
            });

        }
        self.saveFile = saveFile;

        function deleteFile(name, onsuccess) {
            $.post(restBaseUrl + "deleteMilestone", { name: name }, function (resp) {
                if (resp.success) {
                    if (typeof onsuccess !== "undefined") {
                        onsuccess(resp.result);
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
                if (resp.success) {
                    // resp.Result.Milestone
                    updateHeader(resp.result.name, resp.result.milestone, resp.result.description);
                    selectMilestone = resp.result.milestone;
                    setHash(resp.result.name + "-" + resp.result.milestone);
                    showNotification("Milestone " + resp.result.milestone + " created", "info");
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
                if (resp.success) {

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

        function saveFile(name, milestone, html, css, typescript, onSuccess) {
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
