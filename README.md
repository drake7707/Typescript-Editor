# Typescript-Editor
Scratchpad for testing out typescript 3.7.2 snippets

Test it out on: http://drake7707.github.io/Typescript-Editor/ (it will download an example if it's not available in the local storage)

The entries are currently saved to window.localStorage (HTML5 storage) so it's completely client side. 
I initially wrote a server side to run on my rpi and save the entries in a database and store the output of the seperate editors milestone per milestone in a repo directory, which is why you'll find the RestServices class in main.js

If you want to persist things more safely and have everything accessible cross browser you can host the dotnetcore server project to save entries to a folder/sqlite database.

--

I used the Typescript on Ace editor from https://github.com/hi104/typescript-playground-on-ace as a starting point and just built it up from there.

I've replaced the old typescriptservices with the latest last known good build from the corresponding branch and adapted most things to use the new API, so you can use pretty much all the newest and latest things such as generics and so on.

![Screenshot](http://i.imgur.com/h6LI14o.png)
