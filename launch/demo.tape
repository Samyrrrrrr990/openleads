# Records the README GIF with VHS (https://github.com/charmbracelet/vhs):
#   brew install vhs && vhs launch/demo.tape
# Run it after warming the cache once (openleads find "dentists in Austin" -n 6)
# so the recording doesn't sit on network waits.
Output launch/demo.gif
Set FontSize 18
Set Width 1200
Set Height 640
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms

Type "openleads find 'dentists in Austin' -n 6"
Sleep 400ms
Enter
Sleep 9s
Type "openleads recipe add austin 'dentists in Austin' --every 'weekdays 9am'"
Enter
Sleep 2s
Type "openleads schedule status"
Enter
Sleep 4s
