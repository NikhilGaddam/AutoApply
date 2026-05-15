import subprocess
import time

def run():
    # Bring Brave to front and press Return
    script = '''
    tell application "Brave Browser"
        activate
        delay 0.5
        tell application "System Events"
            keystroke return
        end tell
    end tell
    '''
    subprocess.run(["osascript", "-e", script])
    print("Sent Return key to Brave.")
    time.sleep(5)

if __name__ == "__main__":
    run()
