// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title FoundryAnchor
/// @notice Records the first-seen block timestamp of each anchored Merkle
///         root, so off-chain ledger batches can be audited against a
///         public on-chain anchor.
contract FoundryAnchor {
    /// @notice Emitted every time a Merkle root is anchored on-chain.
    /// @param root The anchored Merkle root.
    /// @param autor The address that submitted the anchor transaction.
    /// @param quando The block timestamp of the anchor transaction.
    event Anchored(bytes32 indexed root, address indexed autor, uint256 quando);

    /// @notice First-seen timestamp per Merkle root. Zero means the root
    ///         has never been anchored.
    mapping(bytes32 => uint256) private _roots;

    /// @notice Anchors a Merkle root on-chain. The first-seen timestamp is
    ///         written only once; anchoring the same root again still emits
    ///         the event but does not overwrite the stored timestamp.
    /// @param root The Merkle root to anchor.
    function anchor(bytes32 root) external {
        if (_roots[root] == 0) {
            _roots[root] = block.timestamp;
        }
        emit Anchored(root, msg.sender, block.timestamp);
    }

    /// @notice Returns the first-seen timestamp for a root, or zero if it
    ///         was never anchored.
    /// @param root The Merkle root to look up.
    /// @return The first-seen block timestamp (unix seconds), or 0.
    function get(bytes32 root) external view returns (uint256) {
        return _roots[root];
    }
}
