const parseRow = (row) => JSON.parse(row);

function loadRows(text) {
  return text.split("\n").map(parseRow);
}

loadRows('{"symbol":"AAPL","px":227.1}\nnot-a-json-row');
