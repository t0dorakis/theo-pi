# Personal Autonomous Pi Worker Bootstrap Checklist

## Host-side manual steps
- [ ] Install UTM on MacBook Air
- [ ] Create Ubuntu Server 24.04 LTS VM
- [ ] Allocate 4 CPU / 6-8 GB RAM / 40-80 GB disk
- [ ] Enable SSH during install if prompted
- [ ] Create Linux user `piagent`
- [ ] Boot guest successfully

## Guest-side scripted steps
- [ ] Get repo into guest first: clone `theo-pi` or copy repo into VM
- [ ] Run `~/workspaces/theo-pi/scripts/vm/bootstrap-ubuntu-pi-worker.sh`
- [ ] Run `~/workspaces/theo-pi/scripts/vm/install-theo-pi-worker.sh`
- [ ] Copy `~/workspaces/theo-pi/templates/pi-worker/env.pi.example` to `~/.env.pi`
- [ ] Fill only needed provider keys
- [ ] `chmod 600 ~/.env.pi`

## Access steps
- [ ] Add SSH key to `~/.ssh/authorized_keys`
- [ ] Verify local SSH into guest
- [ ] Install Tailscale in guest
- [ ] Verify remote SSH over tailnet
- [ ] Harden `/etc/ssh/sshd_config`

## Runtime steps
- [ ] Start session: `~/workspaces/theo-pi/scripts/vm/pi-worker-start theo-pi ~/workspaces/theo-pi`
- [ ] Reattach: `tmux attach -t theo-pi`
- [ ] Run `/reload` if needed
- [ ] Verify caveman mode active
- [ ] Verify web access loads

## Verification
- [ ] Run `~/workspaces/theo-pi/scripts/vm/pi-worker-verify.sh`
- [ ] Test file read/write in workspace
- [ ] Test bash command in workspace
- [ ] Test git command in workspace
- [ ] Leave Pi running, disconnect SSH, reconnect later
- [ ] Create clean VM snapshot
