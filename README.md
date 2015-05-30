# Typescript-Editor
Scratchpad for testing out typescript snippets

Test it out on: http://drake7707.github.io/Typescript-Editor/ (it will download an example if it's not available in the local storage)

The entries are currently saved to window.localStorage (HTML5 storage) so it's completely client side. 
I initially wrote a server side to run on my rpi and save the entries in a database and store the output of the seperate editors milestone per milestone in a repo directory, which is why you'll find the RestServices class in main.js

If you want to persist things more safely you should probably create a small serverside REST api that handles the new, save, load, etc. but for demonstration pursposes localStorage works fine.

--

Known issues: 

- The runtime errors are displayed on the wrong line in Firefox. This is because the line number it reports in window.onerror is the actual line number in the entire html page and not in the inline script, like it does in IE and Chrome. I tried fixing it but it's not entirely correct yet, use Chrome or IE if you can for now.

--

I used the Typescript on Ace editor from https://github.com/hi104/typescript-playground-on-ace as a starting point and just built it up from there. I still haven't updated the typescript to the latest version because a lot of the API has changed and I haven't attempted to replace the typescriptServices.js yet, so this is probably still Typescript v0.8 or something like that (sorry no generics yet :( ).

--

If the layout reminds you of JSBin, you're absolutely right. I used JSBin a lot in the past as a javascript scratchpad but I never got the typescript working well (and I really want to use typescript with intellisense and autocompletion), which was exactly why I started this project.
