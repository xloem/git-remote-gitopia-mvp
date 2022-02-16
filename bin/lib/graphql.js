import axios from "axios";
import { parseArgitRemoteURI, getDataReliably } from "./arweave.js";
import { newProgressBar } from "./util.js";

const graphQlEndpoint = "https://arweave.net/graphql";

const getTagValue = (tagName, tags) => {
  for (const tag of tags) {
    if (tag.name === tagName) {
      return tag.value;
    }
  }
};

export const getOidByRef = async (arweave, remoteURI, ref) => {
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  const { data } = await axios({
    url: graphQlEndpoint,
    method: "post",
    data: {
      query: `
      query {
        transactions(
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Type", values: ["update-ref"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "Ref", values: ["${ref}"] }
          ]
          first: 10
        ) {
          edges {
            node {
              id
              tags {
                name
                value
              }
              block {
                height
              }
            }
          }
        }
      }`,
    },
  });

  const edges = data.data.transactions.edges;
  if (edges.length === 0) {
    return {
      oid: null,
      numCommits: 0,
    };
  }

  edges.sort((a, b) => {
    // This implementation treats block height as canonical, then tagged time if block height matches.
    // A more accurate implementation would use the transaction graph to discern more ordering information.
	  
    // This code replaces prior code, adding support for mempool transactions.
    // The prior code only acted for a portion of block differences, maybe to handle a graphql bug,
    // keeping the existing order unmodified otherwise.
    //
    // Without documentation of the bug, this new code sorts all transactions.
    // This could make for surprises if the user's clock is changed before a block is mined.
    // Maybe a solution would be to simply remove the unix time comparison, and return 0.

    var aHeight = null, bHeight = null;

    // if at least one of the transactions is mined, cache relative heights for them
    if (a.node.block !== null) {
      aHeight = a.node.block.height;
      if (b.node.block !== null) {
        bHeight = b.node.block.height;
      } else {
        // b is in mempool but a is not, treat it is after a
        bHeight = aHeight + 1;
      }
    } else {
      if (b.node.block !== null) {
        bHeight = b.node.block.height;
        // a is in mempool but b is not, treat it as after b
        aHeight = bHeight + 1
      }
    }
    if (bHeight == aHeight) {
      const bUnixTime = Number(getTagValue("Unix-Time", b.node.tags));
      const aUnixTime = Number(getTagValue("Unix-Time", a.node.tags));
      return bUnixTime - aUnixTime;
    } else {
      return bHeight - aHeight;
    }
  });

  const id = edges[0].node.id;
  const response = await getDataReliably(arweave, id, {
    decode: true,
    string: true,
  });

  return JSON.parse(response);
};

export const getAllRefs = async (arweave, remoteURI) => {
  let refs = new Set();
  let refOidObj = {};
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  const { data } = await axios({
    url: graphQlEndpoint,
    method: "post",
    data: {
      query: `
      query {
        transactions(
          first: 2147483647
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Type", values: ["update-ref"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Version", values: ["0.0.2"] }
          ]
        ) {
          edges {
            node {
              tags {
                name
                value
              }
            }
          }
        }
      }`,
    },
  });

  const edges = data.data.transactions.edges;

  for (const edge of edges) {
    for (const tag of edge.node.tags) {
      if (tag.name === "Ref") {
        refs.add(tag.value);
        break;
      }
    }
  }

  for (const ref of refs) {
    const { oid } = await getOidByRef(arweave, remoteURI, ref);
    refOidObj[ref] = oid;
  }

  return refOidObj;
};

export const getTransactionIdByObjectId = async (remoteURI, oid) => {
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  const { data } = await axios({
    url: graphQlEndpoint,
    method: "post",
    data: {
      query: `
      query {
        transactions(
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Oid", values: ["${oid}"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "Repo", values: ["${repoName}"] }
            { name: "Type", values: ["git-object"] }
          ]
          first: 1
        ) {
          edges {
            node {
              id
            }
          }
        }
      }`,
    },
  });

  const edges = data.data.transactions.edges;
  return edges[0].node.id;
};

export const fetchGitObjects = async (arweave, arData, remoteURI) => {
  const objects = [];
  const { repoOwnerAddress, repoName } = parseArgitRemoteURI(remoteURI);
  const { data } = await axios({
    url: graphQlEndpoint,
    method: "post",
    data: {
      query: `
      query {
        transactions(
          first: 2147483647
          owners: ["${repoOwnerAddress}"]
          tags: [
            { name: "Type", values: ["git-objects-bundle"] }
            { name: "Version", values: ["0.0.2"] }
            { name: "Repo", values: ["${repoName}"] }
          ]
        ) {
          edges {
            node {
              id
            }
          }
        }
      }`,
    },
  });

  const edges = data.data.transactions.edges;

  const bar1 = newProgressBar();

  console.error(
    "Downloading git objects bundle from Gitopia [this may take a while]"
  );
  bar1.start(edges.length, 0);

  await Promise.all(
    edges.map(async (edge) => {
      const txid = edge.node.id;
      const txData = await getDataReliably(arweave, txid, {
        decode: true,
        string: true,
      });
      const items = await arData.unbundleData(txData);
      await Promise.all(
        items.map(async (item) => {
          const data = await arData.decodeData(item, { string: false });
          for (let i = 0; i < item.tags.length; i++) {
            const tag = await arData.decodeTag(item.tags[i]);
            if (tag.name === "Oid") {
              const oid = tag.value;
              objects.push({ oid, data });
              break;
            }
          }
        })
      );
      bar1.increment();
    })
  );

  bar1.stop();
  console.error("Downloaded git objects bundle from Gitopia successfully");

  return objects;
};
