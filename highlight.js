var newlineElements = setObject("BR", "P", "DIV", "LI");
var nbsp = String.fromCharCode(160);

function scanDOM(root){
  function yield(value, c){cc = c; return value;}
  function push(fun, arg, c){return function(){return fun(arg, c);};}
  var cc = push(scanNode, root, function(){throw StopIteration;});
  
  function scanNode(node, c){
    if (node.nextSibling)
      c = push(scanNode, node.nextSibling, c);
    if (node.nodeType == 3){
      var lines = node.nodeValue.split("\n");
      for (var i = lines.length - 1; i >= 0; i--){
        c = push(yield, lines[i], c);
        if (i > 0)
          c = push(yield, "\n", c);
      }
    }
    else{
      if (node.nodeName in newlineElements)
        c = push(yield, "\n", c);
      if (node.firstChild)
        c = push(scanNode, node.firstChild, c);
    }
    return c();
  }
  return {next: function(){return cc();}};
}

function traverseDOM(start){
  function yield(value, c){cc = c; return value;}
  function push(fun, arg, c){return function(){return fun(arg, c);};}
  function chain(fun, c){return function(){fun(); return c();};}
  var cc = push(scanNode, start, function(){throw StopIteration;});
  var owner = start.ownerDocument;

  function pointAt(node){
    var parent = node.parentNode;
    var next = node.nextSibling;
    if (next)
      return function(newnode){parent.insertBefore(newnode, next);};
    else
      return function(newnode){parent.appendChild(newnode);};
  }
  var point = null;

  function insertNewline(){
    point(withDocument(owner, BR));
  }
  function insertPart(text){
    if (text.length > 0){
      var part = withDocument(owner, partial(SPAN, {"class": "part"}, text));
      part.text = text;
      point(part);
    }
  }

  function writeNode(node, c){
    var parts = scanDOM(node);
    function handlePart(part){
      if (part == "\n")
        insertNewline();
      else
        insertPart(part);
      return push(yield, part, iter());
    }
    function iter(){
      return tryNext(parts, handlePart, constantly(c));
    }
    return iter()();
  }

  function partNode(node){
    if (node.nodeName == "SPAN" && node.childNodes.length == 1 && node.firstChild.nodeType == 3){
      node.text = node.firstChild.nodeValue;
      return node.text.length > 0;
    }
    return false;
  }
  function newlineNode(node){
    return node.nodeName == "BR";
  }

  function scanNode(node, c){
    if (node.nextSibling)
      c = push(scanNode, node.nextSibling, c);
    if (partNode(node)){
      return yield(node.text, c);
    }
    else if (newlineNode(node)){
      return yield("\n", c);
    }
    else {
      point = pointAt(node);
      removeElement(node);
      return writeNode(node, c);
    }
  }

  return {next: function(){return cc();}};
}

var keywords = function(){
  function result(type, style){
    return {type: type, style: style};
  }
  var keywordA = result("keyword a", "keyword");
  var keywordB = result("keyword b", "keyword");
  var keywordC = result("keyword c", "keyword");
  var operator = result("operator", "keyword");
  var atom = result("atom", "atom");
  return {
    "if": keywordA, "switch": keywordA, "while": keywordA, "catch": keywordA, "for": keywordA,
    "else": keywordB, "do": keywordB, "try": keywordB, "finally": keywordB,
    "return": keywordC, "new": keywordC, "delete": keywordC, "break": keywordC, "continue": keywordC,
    "in": operator, "typeof": operator,
    "var": result("var", "keyword"), "function": result("function", "keyword"),
    "true": atom, "false": atom, "null": atom, "undefined": atom, "NaN": atom
  };
}();

var isOperatorChar = matcher(/[\+\-\*\&\%\/=<>!\?]/);
var isDigit = matcher(/[0-9]/);
var isWordChar = matcher(/[\w$_]/);
function isWhiteSpace(ch){
  // Unfortunately, IE's regexp matcher thinks non-breaking spaces
  // aren't whitespace.
  return ch != "\n" && (ch == nbsp || /\s/.test(ch));
}

function tokenize(source){
  source = stringCombiner(source);

  function result(type, style, start){
    nextWhile(isWhiteSpace);
    var value = source.get();
    return {type: type, style: style, value: (start ? start + value : value)};
  }

  function nextWhile(test){
    var next;
    while((next = source.peek()) && test(next))
      source.next();
  }
  function nextUntilUnescaped(end){
    var escaped = false;
    var next;
    while((next = source.peek()) && next != "\n"){
      source.next();
      if (next == end && !escaped)
        break;
      escaped = next == "\\";
    }
  }

  function readNumber(){
    nextWhile(isDigit);
    if (source.peek() == "."){
      source.next();
      nextWhile(isDigit);
    }
    if (source.peek() == "e" || source.peek() == "E"){
      source.next();
      if (source.peek() == "-")
        source.next();
      nextWhile(isDigit);
    }
    return result("number", "atom");
  }
  function readWord(){
    nextWhile(isWordChar);
    var word = source.get();
    var known = keywords[word];
    return known ? result(known.type, known.style, word) : result("variable", "variable", word);
  }
  function readRegexp(){
    nextUntilUnescaped("/");
    nextWhile(matcher(/[gi]/));
    return result("regexp", "string");
  }
  function readMultilineComment(start){
    this.inComment = true;
    var maybeEnd = (start == "*");
    while(true){
      var next = source.peek();
      if (next == "\n")
        break;
      source.next();
      if (next == "/" && maybeEnd){
        this.inComment = false;
        break;
      }
      maybeEnd = next == "*";
    }
    return result("comment", "comment");
  }

  function next(){
    var ch = source.next();
    if (ch == "\n")
      return {type: "newline", style: "whitespace", value: source.get()};
    else if (this.inComment)
      return readMultilineComment.call(this, ch);
    else if (isWhiteSpace(ch))
      return nextWhile(isWhiteSpace) || result("whitespace", "whitespace");
    else if (ch == "\"")
      return nextUntilUnescaped("\"") || result("string", "string");
    else if (/[\[\]{}\(\),;\:]/.test(ch))
      return result(ch, "punctuation");
    else if (isDigit(ch))
      return readNumber();
    else if (ch == "/"){
      next = source.peek();
      if (next == "*")
        return readMultilineComment.call(this, ch);
      else if (next == "/")
        return nextUntilUnescaped(null) || result("comment", "comment");
      else if (this.regexpAllowed)
        return readRegexp();
      else
        return nextWhile(isOperatorChar) || result("operator", "operator");
    }
    else if (isOperatorChar(ch))
      return nextWhile(isOperatorChar) || result("operator", "operator");
    else
      return readWord();
  }

  return {next: next, regexpAllowed: true, inComment: false};
}

var atomicTypes = setObject("atom", "number", "variable", "string", "regexp");  

function parse(source){
  var cc = [statements];
  var context = null;
  var lexical = null;
  var tokens = tokenize(source);
  var column = 0;
  var indented = 0;

  function next(){
    var nextaction = cc[cc.length - 1];
    tokens.regexpAllowed = !nextaction.noRegexp;

    var token = tokens.next();
    if (token.type == "whitespace" && column == 0)
      indented = token.value.length;
    column += token.value.length;
    if (token.type == "newline"){
      indented = column = 0;
      if (lexical && !("align" in lexical))
        lexical.align = false;
    }
    if (token.type == "whitespace" || token.type == "newline" || token.type == "comment")
      return token;
    if (lexical && !("align" in lexical))
      lexical.align = true;

    while(true){
      var result = nextaction(token.type, token.value);
      if (result.pop)
        cc.pop();
      for (var i = result.follow.length - 1; i >= 0; i--)
        cc.push(result.follow[i]);
      if (result.yield)
        return token;
      nextaction = cc[cc.length - 1];
    }
  }

  function sub(){
    return {follow: arguments,
            yield: false,
            pop: false};
  }
  function cont(){
    return {follow: arguments,
            yield: true,
            pop: true};
  }
  function stay(){
    return {follow: [],
            yield: true,
            pop: false};
  }
  function done(){
    return {follow: arguments,
            yield: false,
            pop: true};
  }

  function pushcontext(){
    context = {prev: context, vars: {}};
    return done();
  }
  function popcontext(){
    context = context.prev;
    return done();
  }
  function register(varname){
    if (context)
      context.vars[varname] = true;
  }

  function pushlex(type){
    return function(){
      lexical = {prev: lexical, indented: indented, column: column, type: type};
      return done();
    };
  }
  function poplex(){
    lexical = lexical.prev;
    return done();
  }

  function expect(wanted){
    return function(type){
      if (type == wanted) return cont();
      return stay();
    };
  }

  function statements(type){
    return sub(statement);
  }
  function statement(type){
    if (type == "var") return cont(pushlex("var"), vardef1, expect(";"), poplex);
    if (type == "keyword a") return cont(pushlex("expr"), expression, statement, poplex);
    if (type == "keyword b") return cont(pushlex("expr"), statement, poplex);
    if (type == "function") return cont(pushlex("expr"), functiondef, poplex);
    if (type == "{") return cont(pushlex("{"), block, poplex);
    return done(pushlex("expr"), expression, expect(";"), poplex);
  }
  function expression(type){
    if (type in atomicTypes) {return cont(maybeoperator);}
    if (type == "function") return cont(functiondef);
    if (type == "keyword c") return cont(expression);
    if (type == "(") return cont(pushlex("("), expression, expect(")"), poplex);
    if (type == "operator") return stay();
    return done();
  }
  function maybeoperator(type){
    if (type == "operator") return cont(expression);
    if (type == "(") return cont(pushlex("("), expression, commaseparated, expect(")"), poplex);
    return done();
  }
  maybeoperator.noRegexp = true;
  function commaseparated(type){
    if (type == ",") return cont(expression, commaseparated);
    return done();
  }
  function block(type){
    if (type == "}") return cont();
    return sub(statement);
  }
  function vardef1(type, value){
    if (type == "variable"){
      register(value);
      return cont(vardef2);
    }
    return done();
  }
  function vardef2(type, value){
    if (value == "=")
      return cont(expression, vardef2);
    if (type == ",")
      return cont(vardef1);
    return done();
  }
  function functiondef(type, value){
    if (type == "variable"){
      register(value);
      return cont(functiondef);
    }
    if (type == "(")
      return cont(pushcontext, arglist1, expect(")"), statement, popcontext);
    return done();
  }
  function arglist1(type, value){
    if (type == "variable"){
      register(value);
      return cont(arglist2);
    }
    return done();
  }
  function arglist2(type){
    if (type == ",")
      return cont(arglist1);
    return done();
  }

  return {next: next};
}

function highlight(node){
  if (!node.firstChild)
    return;
  
  function correctPart(token, part){
    return !part.reduced && part.text == token.value && hasClass(part, token.style);
  }
  function shortenPart(part, minus){
    part.text = part.text.substring(minus);
    part.reduced = true;
  }
  function tokenPart(token){
    return withDocument(node.ownerDocument, partial(SPAN, {"class": "part " + token.style}, token.value));
  }

  var parsed = parse(traverseDOM(node.firstChild));
  var part = {
    current: null,
    forward: false,
    get: function(){
      if (!this.current){
        this.current = node.firstChild;
      }
      else if (this.forward){
        this.forward = false;
        this.current = this.current.nextSibling;
      }
      return this.current;
    },
    next: function(){
      if (this.forward)
        this.get();
      this.forward = true;
    },
    remove: function(){
      this.current = this.get().previousSibling;
      node.removeChild(this.current.nextSibling);
      this.forward = true;
    }
  };

  forEach(parsed, function(token){
    if (token.type == "newline"){
      if (!(part.get().nodeName == "BR"))
        throw "Parser out of sync. Expected BR.";
      part.next();
    }
    else {
      if (!(part.get().nodeName == "SPAN"))
        throw "Parser out of sync. Expected SPAN.";
      if (correctPart(token, part.get())){
        part.next();
      }
      else {
        node.insertBefore(tokenPart(token), part.get());
        var tokensize = token.value.length;
        while (tokensize > 0) {
          var partsize = part.get().text.length;
          if (partsize > tokensize){
            shortenPart(part.get(), tokensize);
            tokensize = 0;
          }
          else {
            tokensize -= partsize;
            part.remove();
          }
        }
      }
    }
  });
}

function importCode(code, target){
  code = code.replace(/[ \t]/g, nbsp);
  replaceChildNodes(target, target.ownerDocument.createTextNode(code));
  highlight(target);
}

function addHighlighting(id){
  var textarea = $(id);
  var iframe = createDOM("IFRAME", {"class": "subtle-iframe", id: id, name: id});
  iframe.style.width = textarea.offsetWidth + "px";
  iframe.style.height = textarea.offsetHeight + "px";
  textarea.parentNode.replaceChild(iframe, textarea);

  var fdoc = iframe.contentWindow.document;
  fdoc.designMode = "on";
  fdoc.open();
  fdoc.write("<html><head><link rel=\"stylesheet\" type=\"text/css\" href=\"highlight.css\"/></head>");
  fdoc.write("<body class=\"subtle-iframe editbox\" spellcheck=\"false\"></body></html>");
  fdoc.close();

  function init(){
    importCode(textarea.value, fdoc.body);
  }

  if (document.all)
    init();
  else
    connect(iframe, "onload", function(){disconnectAll(iframe, "onload"); init();});
}
