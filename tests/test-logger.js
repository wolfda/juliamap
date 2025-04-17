export class TestLogger {
    constructor(div) {
        this.div = div
    }

    info(message) {
        this.div.innerHTML += message + "<br/>";
    }

    success(message) {
        this.div.innerHTML += "<span class='success'>" + message + "</span><br/>";
    }

    error(message) {
        this.div.innerHTML += "<span class='error'>" + message + "</span><br/>";
    }
}
