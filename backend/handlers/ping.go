package handlers

import (
	"context"
	"net"
	"net/http"
	"time"
)

type ValorantPingResponse struct {
	CheckedAt int64                `json:"checkedAt"`
	Targets   []ValorantPingTarget `json:"targets"`
}

type ValorantPingTarget struct {
	Region string `json:"region"`
	Label  string `json:"label"`
	Host   string `json:"host"`
	Port   string `json:"port"`
	MS     int64  `json:"ms,omitempty"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
}

var valorantPingRegions = []struct {
	region string
	label  string
}{
	{region: "na", label: "North America"},
	{region: "eu", label: "Europe"},
	{region: "ap", label: "Asia Pacific"},
	{region: "kr", label: "Korea"},
}

func (h *Handler) GetValorantPing(w http.ResponseWriter, r *http.Request) {
	targets := make([]ValorantPingTarget, 0, len(valorantPingRegions))
	for _, item := range valorantPingRegions {
		shard := getShardFromRegion(item.region)
		host := "glz-" + item.region + "-1." + shard + ".a.pvp.net"
		target := pingTCP(item.region, item.label, host, "443")
		targets = append(targets, target)
	}
	h.returnAny(w, ValorantPingResponse{
		CheckedAt: time.Now().UnixMilli(),
		Targets:   targets,
	})
}

func pingTCP(region, label, host, port string) ValorantPingTarget {
	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	defer cancel()
	start := time.Now()
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	if err != nil {
		return ValorantPingTarget{
			Region: region,
			Label:  label,
			Host:   host,
			Port:   port,
			OK:     false,
			Error:  err.Error(),
		}
	}
	_ = conn.Close()
	return ValorantPingTarget{
		Region: region,
		Label:  label,
		Host:   host,
		Port:   port,
		MS:     time.Since(start).Milliseconds(),
		OK:     true,
	}
}
