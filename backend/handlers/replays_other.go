//go:build !windows && !android

package handlers

import "os/exec"

func hideReplayParserWindow(*exec.Cmd) {}
