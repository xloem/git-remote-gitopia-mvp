import axios from "axios";
import { arweave, parseArgitRemoteURI, getDataReliably } from "./arweave.js";
import { newProgressBar } from "./util.js";

const apiCfg = arweave.getConfig().api;
const graphQlEndpoint = `${apiCfg.protocol}://${apiCfg.host}:${apiCfg.port}/graphql`

const getTagValue = (tagName, tags) => {
  for (const tag of tags) {
    if (tag.name === tagName) {
      return tag.value;
    }
  }
};

export const getOidByRef = async (remoteURI, ref) => {
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
  if (edges.length === 0) {
    return {
      oid: null,
      numCommits: 0,
    };
  }

  const id = edges[0].node.id;
  const response = await getDataReliably(id, {
    decode: true,
    string: true,
  });

  return JSON.parse(response);
};

export const getAllRefs = async (remoteURI) => {
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
    const { oid } = await getOidByRef(remoteURI, ref);
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

export const fetchGitObjects = async (arData, remoteURI) => {
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
      const txData = await getDataReliably(txid, {
        decode: true,
        string: true,
      });

      try {
        const items = await arData.unbundleData(txData);
        for (const item of items) {
          const data = await arData.decodeData(item, { string: false });
          for (let i = 0; i < item.tags.length; i++) {
            const tag = await arData.decodeTag(item.tags[i]);
            if (tag.name === "Oid") {
              const oid = tag.value;
              objects.push({ oid, data });
              break;
            }
          }
        }
      } catch (err) {
        // corrupt bundled data
      }

      bar1.increment();
    })
  );

  bar1.stop();
  console.error("Downloaded git objects bundle from Gitopia successfully");

  return objects;
};
