# Typescript-Editor
Scratchpad for testing out typescript 1.5 snippets

Test it out on: http://drake7707.github.io/Typescript-Editor/ (it will download an example if it's not available in the local storage)

The entries are currently saved to window.localStorage (HTML5 storage) so it's completely client side. 
I initially wrote a server side to run on my rpi and save the entries in a database and store the output of the seperate editors milestone per milestone in a repo directory, which is why you'll find the RestServices class in main.js

If you want to persist things more safely you should probably create a small serverside REST api that handles the new, save, load, etc. but for demonstration pursposes localStorage works fine.

--

I used the Typescript on Ace editor from https://github.com/hi104/typescript-playground-on-ace as a starting point and just built it up from there.

I've replaced the old typescriptservices with the latest last known good build from the release-1.5 branch and adapted most things to use the new API, so you can use pretty much all the newest and latest things such as generics and so on.

--

If the layout reminds you of JSBin, you're absolutely right. I used JSBin a lot in the past as a javascript scratchpad but I never got the typescript working well (and I really want to use typescript with intellisense and autocompletion), which was exactly why I started this project.
