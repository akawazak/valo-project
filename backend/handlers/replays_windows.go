package handlers

import (
	"os/exec"
	"syscall"
)

// hideReplayParserWindow keeps the console parser from flashing a window.
func hideReplayParserWindow(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
