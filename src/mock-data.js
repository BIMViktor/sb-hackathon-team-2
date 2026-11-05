/** Fake project used when the widget is opened outside StreamBIM. */

export const project = {
  id: "hackathon-sandbox",
  name: "Hackathon Sandbox",
  userEmail: "team@hackathon.local",
};

export const floors = [
  { id: "floor-1", name: "Plan 1", elevation: 0 },
  { id: "floor-2", name: "Plan 2", elevation: 3.2 },
  { id: "floor-3", name: "Plan 3", elevation: 6.4 },
];

export const objects = [
  {
    guid: "MOCK-DOOR-101",
    name: "Dörr 101",
    type: "IfcDoor",
    floorId: "floor-1",
    point: [4.2, 1.1, 0.9],
    props: {
      Type: "IfcDoor",
      Name: "Dörr 101",
      IsExternal: "True",
      "BIP~TypeID": "GPPD-UT",
      "BIP~TypeDescription": "Ytterdörrar",
      "BIP~StoreyName": "Plan 1",
    },
  },
  {
    guid: "MOCK-WALL-A",
    name: "Vägg A",
    type: "IfcWall",
    floorId: "floor-1",
    point: [2, 1.4, 0],
    props: {
      Type: "IfcWall",
      Name: "Vägg A",
      IsExternal: "True",
      "BIP~TypeID": "YV01",
      "BIP~TypeDescription": "Ytterväggar",
      "BIP~StoreyName": "Plan 1",
    },
  },
  {
    guid: "MOCK-WALL-B",
    name: "Vägg B",
    type: "IfcWall",
    floorId: "floor-2",
    point: [3, 4.4, 0],
    props: {
      Type: "IfcWall",
      Name: "Vägg B",
      IsExternal: "False",
      "BIP~TypeID": "V1",
      "BIP~TypeDescription": "Innerväggar",
      "BIP~StoreyName": "Plan 2",
    },
  },
  {
    guid: "MOCK-WINDOW-12",
    name: "Fönster 12",
    type: "IfcWindow",
    floorId: "floor-2",
    point: [6.5, 4.6, 1.2],
    props: {
      Type: "IfcWindow",
      Name: "Fönster 12",
      IsExternal: "True",
      "BIP~TypeID": "FO03",
      "BIP~TypeDescription": "Fönster och fönsterdörrar",
      "BIP~StoreyName": "Plan 2",
    },
  },
  {
    guid: "MOCK-WINDOW-13",
    name: "Fönster 13",
    type: "IfcWindow",
    floorId: "floor-2",
    point: [7.5, 4.6, 1.2],
    props: {
      Type: "IfcWindow",
      Name: "Fönster 13",
      IsExternal: "True",
      "BIP~TypeID": "FO03",
      "BIP~TypeDescription": "Fönster och fönsterdörrar",
      "BIP~StoreyName": "Plan 2",
    },
  },
  {
    guid: "MOCK-WINDOW-14",
    name: "Fönsterdörr 14",
    type: "IfcWindow",
    floorId: "floor-3",
    point: [7.5, 7.8, 1.2],
    props: {
      Type: "IfcWindow",
      Name: "Fönsterdörr 14",
      IsExternal: "True",
      "BIP~TypeID": "FO031",
      "BIP~TypeDescription": "Fönster och fönsterdörrar",
      "BIP~StoreyName": "Plan 3",
    },
  },
  {
    guid: "MOCK-SPACE-201",
    name: "Rum 201",
    type: "IfcSpace",
    floorId: "floor-2",
    point: [8, 4.8, 1.5],
    props: { Type: "IfcSpace", Name: "Rum 201", LongName: "Mötesrum" },
  },
];

export const folders = [
  { id: "10", name: "Beskrivningar" },
  { id: "20", name: "Ritningar" },
];

/** Real files in public/mock-pdfs, so a local scan runs the same pdf.js path as live. */
export const documents = [
  { id: "1001", filename: "Fonsterforteckning.pdf", filesize: 1138, revision: 1, folderId: "10" },
  { id: "1002", filename: "Dorrforteckning.pdf", filesize: 731, revision: 1, folderId: "10" },
  { id: "1003", filename: "Teknisk-beskrivning.pdf", filesize: 1408, revision: 2, folderId: "10" },
  { id: "1004", filename: "Tillval-fonsterdorr.pdf", filesize: 682, revision: 1, folderId: "10" },
  { id: "2001", filename: "Inskannad-ritning.pdf", filesize: 634, revision: 1, folderId: "20" },
];
