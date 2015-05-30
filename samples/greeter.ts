class Greeter { 
	greeting: string;
	constructor (message: string) {
		this.greeting = message;
	}
	greet() {
		return "Hello, " + this.greeting;
	}
}

var greeter = new Greeter("world");

var button = document.createElement('button');
button.innerHTML = "Say Hello";
button.onclick = function() {
	alert(greeter.greet());
}

document.body.appendChild(button);
