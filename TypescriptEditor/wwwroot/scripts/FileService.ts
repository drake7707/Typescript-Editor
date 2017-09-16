// Not using the AMD export built into typescript since we are using the partial
// implementation of requirejs as present in ACE editor

// Gets a file from the server
export class FileService{

    constructor(public ajaxHost){}

    public readFile(path,cb){
        this.ajaxHost.ajax({
            type: "GET",
            url: path,
            success: cb,
            dataType: "text",
            error :((jqXHR, textStatus) =>
                console.log(textStatus)
                )}
            );
        }
}

export class OperatingSystemService {

    public EOL: string = "\r\n";

    public platform(): string {
        return "browser";
    }


}

export class PathService {

    public resolve(path:string): string {
        return "/dummy/" + path;
    }
}