// Not using the AMD export built into typescript since we are using the partial
// implementation of requirejs as present in ACE editor
define(["require", "exports"], function(require, exports) {
    // Gets a file from the server
    var FileService = (function () {
        function FileService(ajaxHost) {
            this.ajaxHost = ajaxHost;
        }
        FileService.prototype.readFile = function (path, cb) {
            this.ajaxHost.ajax({
                type: "GET",
                url: path,
                success: cb,
                dataType: "text",
                error: (function (jqXHR, textStatus) {
                    return console.log(textStatus);
                }) });
        };
        return FileService;
    })();
    exports.FileService = FileService;

    var OperatingSystemService = (function () {
        function OperatingSystemService() {
            this.EOL = "\r\n";
        }
        OperatingSystemService.prototype.platform = function () {
            return "browser";
        };
        return OperatingSystemService;
    })();
    exports.OperatingSystemService = OperatingSystemService;

    var PathService = (function () {
        function PathService() {
        }
        PathService.prototype.resolve = function (path) {
            return "/dummy/" + path;
        };
        return PathService;
    })();
    exports.PathService = PathService;
});
