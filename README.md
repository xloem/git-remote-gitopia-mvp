# git-remote-gitopia-mvp

This is a fork of the old arweave git remote helper for what is now [Gitopia](https://gitopia.org).

It provides for making use of git repositories on the arweave blockchain.

Help is needed, as gitopia has moved to their own chain. Please contribute work or changes to this repo, or fork it again.

## Installation

`yarn global add https://github.com/xloem/git-remote-gitopia-mvp`

## Steps to Build

- `yarn install`
- `yarn link`

## Usage

Set the following environment variable with the path of your Arweave wallet file.  
`export GITOPIA_WALLET_PATH=/path/to/wallet`

You don't need to run `git-remote-gitopia-mvp` directly, it will be called automatically by `git` when it encounters remote of the form `gitopia-mvp://`
