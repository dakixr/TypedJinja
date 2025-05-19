from typedjinja.parser import extract_type_annotations


def test_extract_type_annotations_basic():
    template = """{# @types\n   user: User\n   items: List[Item]\n   show_details: bool\n#}\n\nHello, {{ user.name }}!\n"""
    expected = {
        "user": "User",
        "items": "List[Item]",
        "show_details": "bool",
    }
    assert extract_type_annotations(template) == expected


def test_extract_type_annotations_no_block():
    template = "<h1>No types here</h1>"
    assert extract_type_annotations(template) == {}


def test_extract_type_annotations_empty_block():
    template = """{# @types\n#}\nContent"""
    assert extract_type_annotations(template) == {}


def test_extract_type_annotations_ignores_invalid_lines():
    template = """{# @types\n   user: User\n   invalid_line\n   items: List[Item]\n#}"""
    expected = {
        "user": "User",
        "items": "List[Item]",
    }
    assert extract_type_annotations(template) == expected
