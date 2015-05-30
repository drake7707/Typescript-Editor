# Typescript-Editor
Scratchpad for testing out typescript snippets


The entries are currently saved to window.localStorage (HTML5 storage) so it's completely client side. 
I initially wrote a server side to run on my rpi and save the entries in a database and store the output of the seperate editors milestone per milestone in a repo directory, which is why you'll find the RestServices class in main.js

If you want to persist things more safely you should probably create a small serverside REST api that handles the new, save, load, etc. but for demonstration pursposes localStorage works fine.
