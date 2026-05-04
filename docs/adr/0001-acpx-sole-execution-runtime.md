# ACPX is the sole execution runtime

Pi worker executes jobs only through ACPX. Earlier backend abstractions for tmux and smolvm were removed because they were shallow, hard to verify, and blocked use of ACPX-native sessions, events, cancellation, and runtime controls; `backendId: "acpx"` remains only as artifact metadata.
